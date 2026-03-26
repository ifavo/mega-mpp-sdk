// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.30;

import { IERC20 } from "lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "lib/openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import { ECDSA } from "lib/openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {
  EIP712Upgradeable
} from "lib/openzeppelin-contracts-upgradeable/contracts/utils/cryptography/EIP712Upgradeable.sol";
import {
  Initializable
} from "lib/openzeppelin-contracts-upgradeable/contracts/proxy/utils/Initializable.sol";
import {
  UUPSUpgradeable
} from "lib/openzeppelin-contracts-upgradeable/contracts/proxy/utils/UUPSUpgradeable.sol";
import {
  OwnableUpgradeable
} from "lib/openzeppelin-contracts-upgradeable/contracts/access/OwnableUpgradeable.sol";
import {
  ReentrancyGuardUpgradeable
} from "lib/openzeppelin-contracts-upgradeable/contracts/utils/ReentrancyGuardUpgradeable.sol";

contract MegaMppSessionEscrow is
  Initializable,
  EIP712Upgradeable,
  OwnableUpgradeable,
  UUPSUpgradeable,
  ReentrancyGuardUpgradeable
{
  using SafeERC20 for IERC20;

  string public constant DOMAIN_NAME = "MegaETH MPP Session Escrow";
  string public constant DOMAIN_VERSION = "1";

  bytes32 public constant VOUCHER_TYPEHASH =
    keccak256("Voucher(bytes32 channelId,uint256 cumulativeAmount)");

  struct Channel {
    address payer;
    address payee;
    address token;
    address authorizedSigner;
    uint256 deposit;
    uint256 settled;
    uint64 openedAt;
    uint64 closeRequestedAt;
    bool finalized;
  }

  error ZeroAddress(string field);
  error ZeroDeposit();
  error ChannelAlreadyExists(bytes32 channelId);
  error ChannelNotFound(bytes32 channelId);
  error ChannelFinalized(bytes32 channelId);
  error Unauthorized(address caller);
  error CloseAlreadyRequested(bytes32 channelId);
  error CloseNotRequested(bytes32 channelId);
  error CloseDelayNotElapsed(bytes32 channelId, uint256 readyAt);
  error InvalidVoucherSigner(address recovered, address expectedSigner);
  error CumulativeAmountBelowSettled(bytes32 channelId, uint256 cumulativeAmount, uint256 settled);
  error CumulativeAmountExceedsDeposit(
    bytes32 channelId, uint256 cumulativeAmount, uint256 deposit
  );
  error ExactTransferTokenRequired(address token, uint256 expectedAmount, uint256 actualAmount);

  event ChannelOpened(
    bytes32 indexed channelId,
    address indexed payer,
    address indexed payee,
    address token,
    uint256 deposit,
    address authorizedSigner,
    bytes32 salt
  );
  event ChannelSettled(bytes32 indexed channelId, uint256 cumulativeAmount, uint256 delta);
  event ChannelToppedUp(bytes32 indexed channelId, uint256 amount, uint256 newDeposit);
  event ChannelCloseRequested(bytes32 indexed channelId, uint64 closeRequestedAt);
  event ChannelClosed(
    bytes32 indexed channelId, uint256 cumulativeAmount, uint256 payout, uint256 refund
  );
  event ChannelWithdrawn(bytes32 indexed channelId, uint256 refund);
  event CloseDelaySecondsUpdated(uint64 closeDelaySeconds);

  mapping(bytes32 channelId => Channel) private _channels;

  uint64 public closeDelaySeconds;

  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }

  function initialize(
    address owner_,
    uint64 closeDelaySeconds_
  ) external initializer {
    if (owner_ == address(0)) {
      revert ZeroAddress("owner");
    }

    __EIP712_init(DOMAIN_NAME, DOMAIN_VERSION);
    __Ownable_init(owner_);
    __UUPSUpgradeable_init();
    __ReentrancyGuard_init();

    closeDelaySeconds = closeDelaySeconds_;
    emit CloseDelaySecondsUpdated(closeDelaySeconds_);
  }

  function setCloseDelaySeconds(
    uint64 nextCloseDelaySeconds
  ) external onlyOwner {
    closeDelaySeconds = nextCloseDelaySeconds;
    emit CloseDelaySecondsUpdated(nextCloseDelaySeconds);
  }

  function open(
    address payee,
    address token,
    uint256 deposit,
    bytes32 salt,
    address authorizedSigner
  ) external nonReentrant returns (bytes32 channelId) {
    if (payee == address(0)) {
      revert ZeroAddress("payee");
    }
    if (token == address(0)) {
      revert ZeroAddress("token");
    }
    if (deposit == 0) {
      revert ZeroDeposit();
    }

    channelId = computeChannelId(msg.sender, payee, token, authorizedSigner, salt);
    if (_channels[channelId].payer != address(0)) {
      revert ChannelAlreadyExists(channelId);
    }

    _safeTransferFromExact(token, msg.sender, deposit);

    _channels[channelId] = Channel({
      payer: msg.sender,
      payee: payee,
      token: token,
      authorizedSigner: authorizedSigner,
      deposit: deposit,
      settled: 0,
      openedAt: uint64(block.timestamp),
      closeRequestedAt: 0,
      finalized: false
    });

    emit ChannelOpened(channelId, msg.sender, payee, token, deposit, authorizedSigner, salt);
  }

  function settle(
    bytes32 channelId,
    uint256 cumulativeAmount,
    bytes calldata signature
  ) external nonReentrant {
    Channel storage channel = _requireActiveChannel(channelId);
    if (msg.sender != channel.payee) {
      revert Unauthorized(msg.sender);
    }

    _validateVoucher(channelId, channel, cumulativeAmount, signature);
    uint256 delta = cumulativeAmount - channel.settled;
    if (delta > 0) {
      channel.settled = cumulativeAmount;
      _safeTransferExact(channel.token, channel.payee, delta);
    }

    emit ChannelSettled(channelId, cumulativeAmount, delta);
  }

  function topUp(
    bytes32 channelId,
    uint256 amount
  ) external nonReentrant {
    Channel storage channel = _requireActiveChannel(channelId);
    if (msg.sender != channel.payer) {
      revert Unauthorized(msg.sender);
    }
    if (amount == 0) {
      revert ZeroDeposit();
    }

    _safeTransferFromExact(channel.token, msg.sender, amount);
    channel.deposit += amount;
    channel.closeRequestedAt = 0;

    emit ChannelToppedUp(channelId, amount, channel.deposit);
  }

  function close(
    bytes32 channelId,
    uint256 cumulativeAmount,
    bytes calldata signature
  ) external nonReentrant {
    Channel storage channel = _requireActiveChannel(channelId);
    if (msg.sender != channel.payee) {
      revert Unauthorized(msg.sender);
    }

    _validateVoucher(channelId, channel, cumulativeAmount, signature);
    channel.finalized = true;
    channel.closeRequestedAt = 0;

    uint256 payout = cumulativeAmount - channel.settled;
    uint256 refund = channel.deposit - cumulativeAmount;
    channel.settled = cumulativeAmount;

    if (payout > 0) {
      _safeTransferExact(channel.token, channel.payee, payout);
    }
    if (refund > 0) {
      _safeTransferExact(channel.token, channel.payer, refund);
    }

    emit ChannelClosed(channelId, cumulativeAmount, payout, refund);
  }

  function requestClose(
    bytes32 channelId
  ) external {
    Channel storage channel = _requireActiveChannel(channelId);
    if (msg.sender != channel.payer) {
      revert Unauthorized(msg.sender);
    }
    if (channel.closeRequestedAt != 0) {
      revert CloseAlreadyRequested(channelId);
    }

    channel.closeRequestedAt = uint64(block.timestamp);
    emit ChannelCloseRequested(channelId, channel.closeRequestedAt);
  }

  function withdraw(
    bytes32 channelId
  ) external nonReentrant {
    Channel storage channel = _requireActiveChannel(channelId);
    if (msg.sender != channel.payer) {
      revert Unauthorized(msg.sender);
    }
    if (channel.closeRequestedAt == 0) {
      revert CloseNotRequested(channelId);
    }

    uint256 readyAt = uint256(channel.closeRequestedAt) + closeDelaySeconds;
    if (block.timestamp < readyAt) {
      revert CloseDelayNotElapsed(channelId, readyAt);
    }

    channel.finalized = true;
    uint256 refund = channel.deposit - channel.settled;
    channel.closeRequestedAt = 0;

    if (refund > 0) {
      _safeTransferExact(channel.token, channel.payer, refund);
    }

    emit ChannelWithdrawn(channelId, refund);
  }

  function getChannel(
    bytes32 channelId
  ) external view returns (Channel memory) {
    return _channels[channelId];
  }

  function getChannelsBatch(
    bytes32[] calldata channelIds
  ) external view returns (Channel[] memory channels) {
    uint256 length = channelIds.length;
    channels = new Channel[](length);

    for (uint256 index = 0; index < length; index++) {
      channels[index] = _channels[channelIds[index]];
    }
  }

  function computeChannelId(
    address payer,
    address payee,
    address token,
    address authorizedSigner,
    bytes32 salt
  ) public view returns (bytes32) {
    return keccak256(
      abi.encode(block.chainid, address(this), payer, payee, token, authorizedSigner, salt)
    );
  }

  function getVoucherDigest(
    bytes32 channelId,
    uint256 cumulativeAmount
  ) public view returns (bytes32) {
    bytes32 structHash = keccak256(abi.encode(VOUCHER_TYPEHASH, channelId, cumulativeAmount));
    return _hashTypedDataV4(structHash);
  }

  function domainSeparator() external view returns (bytes32) {
    return _domainSeparatorV4();
  }

  function _requireActiveChannel(
    bytes32 channelId
  ) internal view returns (Channel storage channel) {
    channel = _channels[channelId];
    if (channel.payer == address(0)) {
      revert ChannelNotFound(channelId);
    }
    if (channel.finalized) {
      revert ChannelFinalized(channelId);
    }
  }

  function _validateVoucher(
    bytes32 channelId,
    Channel storage channel,
    uint256 cumulativeAmount,
    bytes calldata signature
  ) internal view {
    if (cumulativeAmount < channel.settled) {
      revert CumulativeAmountBelowSettled(channelId, cumulativeAmount, channel.settled);
    }
    if (cumulativeAmount > channel.deposit) {
      revert CumulativeAmountExceedsDeposit(channelId, cumulativeAmount, channel.deposit);
    }

    address recoveredSigner =
      ECDSA.recover(getVoucherDigest(channelId, cumulativeAmount), signature);
    address expectedSigner =
      channel.authorizedSigner == address(0) ? channel.payer : channel.authorizedSigner;
    if (recoveredSigner != expectedSigner) {
      revert InvalidVoucherSigner(recoveredSigner, expectedSigner);
    }
  }

  function _safeTransferFromExact(
    address token,
    address from,
    uint256 amount
  ) internal {
    IERC20 tokenContract = IERC20(token);
    uint256 balanceBefore = tokenContract.balanceOf(address(this));
    tokenContract.safeTransferFrom(from, address(this), amount);
    _requireExactTransfer(token, amount, balanceBefore, tokenContract.balanceOf(address(this)));
  }

  function _safeTransferExact(
    address token,
    address recipient,
    uint256 amount
  ) internal {
    IERC20 tokenContract = IERC20(token);
    uint256 balanceBefore = tokenContract.balanceOf(recipient);
    tokenContract.safeTransfer(recipient, amount);
    _requireExactTransfer(token, amount, balanceBefore, tokenContract.balanceOf(recipient));
  }

  function _requireExactTransfer(
    address token,
    uint256 expectedAmount,
    uint256 balanceBefore,
    uint256 balanceAfter
  ) internal pure {
    uint256 actualAmount = balanceAfter >= balanceBefore ? balanceAfter - balanceBefore : 0;
    if (actualAmount != expectedAmount) {
      revert ExactTransferTokenRequired(token, expectedAmount, actualAmount);
    }
  }

  function _authorizeUpgrade(
    address newImplementation
  ) internal view override onlyOwner {
    if (newImplementation == address(0)) {
      revert ZeroAddress("newImplementation");
    }
  }
}
