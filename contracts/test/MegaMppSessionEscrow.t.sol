// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.30;

import { Test } from "lib/openzeppelin-contracts/lib/forge-std/src/Test.sol";
import { ERC1967Proxy } from "lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {
  Initializable
} from "lib/openzeppelin-contracts-upgradeable/contracts/proxy/utils/Initializable.sol";

import { MegaMppSessionEscrow } from "../src/MegaMppSessionEscrow.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";
import { MockFeeOnTransferERC20 } from "./mocks/MockFeeOnTransferERC20.sol";

contract MegaMppSessionEscrowV2 is MegaMppSessionEscrow {
  function version() external pure returns (string memory) {
    return "v2";
  }
}

contract MegaMppSessionEscrowTest is Test {
  uint64 internal constant CLOSE_DELAY_SECONDS = 1 days;

  MegaMppSessionEscrow internal escrow;
  MockERC20 internal token;

  uint256 internal ownerPk = 0xA11CE;
  uint256 internal payerPk = 0xB0B;
  uint256 internal signerPk = 0xC0DE;
  uint256 internal payeePk = 0xD0D0;

  address internal owner;
  address internal payer;
  address internal signer;
  address internal payee;

  function setUp() public {
    owner = vm.addr(ownerPk);
    payer = vm.addr(payerPk);
    signer = vm.addr(signerPk);
    payee = vm.addr(payeePk);

    token = new MockERC20("Test USDC", "USDC", 6);
    token.mint(payer, 5_000_000);

    MegaMppSessionEscrow implementation = new MegaMppSessionEscrow();
    ERC1967Proxy proxy = new ERC1967Proxy(
      address(implementation),
      abi.encodeCall(MegaMppSessionEscrow.initialize, (owner, CLOSE_DELAY_SECONDS))
    );
    escrow = MegaMppSessionEscrow(address(proxy));

    vm.startPrank(payer);
    token.approve(address(escrow), type(uint256).max);
    vm.stopPrank();
  }

  function test_openComputesDeterministicChannelId() public {
    bytes32 salt = keccak256("demo-open");
    bytes32 expectedChannelId =
      escrow.computeChannelId(payer, payee, address(token), address(0), salt);

    vm.prank(payer);
    bytes32 openedChannelId = escrow.open(payee, address(token), 1_000_000, salt, address(0));

    assertEq(openedChannelId, expectedChannelId);

    MegaMppSessionEscrow.Channel memory channel = escrow.getChannel(expectedChannelId);
    assertEq(channel.payer, payer);
    assertEq(channel.payee, payee);
    assertEq(channel.token, address(token));
    assertEq(channel.authorizedSigner, address(0));
    assertEq(channel.deposit, 1_000_000);
    assertEq(token.balanceOf(address(escrow)), 1_000_000);
  }

  function test_implementationConstructorDisablesInitializers() public {
    MegaMppSessionEscrow implementation = new MegaMppSessionEscrow();

    vm.expectRevert(Initializable.InvalidInitialization.selector);
    implementation.initialize(owner, CLOSE_DELAY_SECONDS);
  }

  function test_delegatedSignerChannelWorks() public {
    bytes32 channelId =
      _openChannel({ authorizedSigner: signer, deposit: 1_000_000, salt: keccak256("delegated") });

    bytes memory signature = _signVoucher(signerPk, channelId, 400_000);

    vm.prank(payee);
    escrow.settle(channelId, 400_000, signature);

    MegaMppSessionEscrow.Channel memory channel = escrow.getChannel(channelId);
    assertEq(channel.settled, 400_000);
    assertEq(token.balanceOf(payee), 400_000);
    assertEq(token.balanceOf(address(escrow)), 600_000);
  }

  function test_settlePaysOnlyDelta() public {
    bytes32 channelId =
      _openChannel({ authorizedSigner: address(0), deposit: 1_000_000, salt: keccak256("delta") });
    bytes memory firstSignature = _signVoucher(payerPk, channelId, 250_000);
    bytes memory secondSignature = _signVoucher(payerPk, channelId, 800_000);

    vm.prank(payee);
    escrow.settle(channelId, 250_000, firstSignature);

    vm.prank(payee);
    escrow.settle(channelId, 800_000, secondSignature);

    assertEq(token.balanceOf(payee), 800_000);
    assertEq(token.balanceOf(address(escrow)), 200_000);
    assertEq(escrow.getChannel(channelId).settled, 800_000);
  }

  function test_openRevertsWhenTransferInAmountIsShort() public {
    MockFeeOnTransferERC20 feeToken = _createFeeToken();
    feeToken.setFees(0, 1000);

    bytes32 salt = keccak256("short-open");
    bytes32 channelId = escrow.computeChannelId(payer, payee, address(feeToken), address(0), salt);

    vm.prank(payer);
    vm.expectRevert(
      abi.encodeWithSelector(
        MegaMppSessionEscrow.ExactTransferTokenRequired.selector,
        address(feeToken),
        1_000_000,
        900_000
      )
    );
    escrow.open(payee, address(feeToken), 1_000_000, salt, address(0));

    MegaMppSessionEscrow.Channel memory channel = escrow.getChannel(channelId);
    assertEq(channel.payer, address(0));
    assertEq(feeToken.balanceOf(address(escrow)), 0);
  }

  function test_topUpIncreasesDepositAndCancelsPendingClose() public {
    bytes32 channelId =
      _openChannel({ authorizedSigner: address(0), deposit: 500_000, salt: keccak256("topup") });

    vm.prank(payer);
    escrow.requestClose(channelId);

    vm.prank(payer);
    escrow.topUp(channelId, 250_000);

    MegaMppSessionEscrow.Channel memory channel = escrow.getChannel(channelId);
    assertEq(channel.deposit, 750_000);
    assertEq(channel.closeRequestedAt, 0);
    assertEq(token.balanceOf(address(escrow)), 750_000);
  }

  function test_topUpRevertsWhenTransferInAmountIsShort() public {
    MockFeeOnTransferERC20 feeToken = _createFeeToken();
    bytes32 salt = keccak256("short-topup");

    vm.prank(payer);
    bytes32 channelId = escrow.open(payee, address(feeToken), 500_000, salt, address(0));

    feeToken.setFees(0, 1000);

    vm.prank(payer);
    vm.expectRevert(
      abi.encodeWithSelector(
        MegaMppSessionEscrow.ExactTransferTokenRequired.selector,
        address(feeToken),
        250_000,
        225_000
      )
    );
    escrow.topUp(channelId, 250_000);

    MegaMppSessionEscrow.Channel memory channel = escrow.getChannel(channelId);
    assertEq(channel.deposit, 500_000);
    assertEq(feeToken.balanceOf(address(escrow)), 500_000);
  }

  function test_closeSettlesAndRefundsCorrectly() public {
    bytes32 channelId =
      _openChannel({ authorizedSigner: address(0), deposit: 1_000_000, salt: keccak256("close") });
    bytes memory signature = _signVoucher(payerPk, channelId, 650_000);

    vm.prank(payee);
    escrow.close(channelId, 650_000, signature);

    MegaMppSessionEscrow.Channel memory channel = escrow.getChannel(channelId);
    assertTrue(channel.finalized);
    assertEq(channel.settled, 650_000);
    assertEq(token.balanceOf(payee), 650_000);
    assertEq(token.balanceOf(payer), 5_000_000 - 1_000_000 + 350_000);
    assertEq(token.balanceOf(address(escrow)), 0);
  }

  function test_settleRevertsWhenTransferOutAmountIsShort() public {
    MockFeeOnTransferERC20 feeToken = _createFeeToken();
    bytes32 salt = keccak256("short-settle");

    vm.prank(payer);
    bytes32 channelId = escrow.open(payee, address(feeToken), 1_000_000, salt, address(0));

    feeToken.setFees(500, 0);
    bytes memory signature = _signVoucher(payerPk, channelId, 250_000);

    vm.prank(payee);
    vm.expectRevert(
      abi.encodeWithSelector(
        MegaMppSessionEscrow.ExactTransferTokenRequired.selector,
        address(feeToken),
        250_000,
        237_500
      )
    );
    escrow.settle(channelId, 250_000, signature);

    MegaMppSessionEscrow.Channel memory channel = escrow.getChannel(channelId);
    assertEq(channel.settled, 0);
    assertEq(feeToken.balanceOf(payee), 0);
    assertEq(feeToken.balanceOf(address(escrow)), 1_000_000);
  }

  function test_requestCloseAndWithdrawFollowGracePeriod() public {
    bytes32 channelId =
      _openChannel({ authorizedSigner: address(0), deposit: 800_000, salt: keccak256("withdraw") });
    bytes memory signature = _signVoucher(payerPk, channelId, 300_000);

    vm.prank(payee);
    escrow.settle(channelId, 300_000, signature);

    vm.prank(payer);
    escrow.requestClose(channelId);

    vm.prank(payer);
    vm.expectRevert();
    escrow.withdraw(channelId);

    vm.warp(block.timestamp + CLOSE_DELAY_SECONDS);

    vm.prank(payer);
    escrow.withdraw(channelId);

    MegaMppSessionEscrow.Channel memory channel = escrow.getChannel(channelId);
    assertTrue(channel.finalized);
    assertEq(token.balanceOf(payee), 300_000);
    assertEq(token.balanceOf(payer), 5_000_000 - 800_000 + 500_000);
  }

  function test_uupsUpgradeRequiresOwner() public {
    MegaMppSessionEscrowV2 upgraded = new MegaMppSessionEscrowV2();

    vm.prank(payer);
    vm.expectRevert();
    escrow.upgradeToAndCall(address(upgraded), bytes(""));

    vm.prank(owner);
    escrow.upgradeToAndCall(address(upgraded), bytes(""));

    assertEq(MegaMppSessionEscrowV2(address(escrow)).version(), "v2");
  }

  function _openChannel(
    address authorizedSigner,
    uint256 deposit,
    bytes32 salt
  ) internal returns (bytes32 channelId) {
    vm.prank(payer);
    channelId = escrow.open(payee, address(token), deposit, salt, authorizedSigner);
  }

  function _signVoucher(
    uint256 privateKey,
    bytes32 channelId,
    uint256 cumulativeAmount
  ) internal view returns (bytes memory signature) {
    bytes32 digest = escrow.getVoucherDigest(channelId, cumulativeAmount);
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
    signature = abi.encodePacked(r, s, v);
  }

  function _createFeeToken() internal returns (MockFeeOnTransferERC20 feeToken) {
    feeToken = new MockFeeOnTransferERC20("Taxed USDC", "tUSDC", 6);
    feeToken.mint(payer, 5_000_000);

    vm.startPrank(payer);
    feeToken.approve(address(escrow), type(uint256).max);
    vm.stopPrank();
  }
}
