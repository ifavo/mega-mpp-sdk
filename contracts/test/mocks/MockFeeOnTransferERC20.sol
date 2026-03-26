// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.30;

import { ERC20 } from "lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

contract MockFeeOnTransferERC20 is ERC20 {
  uint8 private immutable _customDecimals;
  uint16 private _transferFeeBps;
  uint16 private _transferFromFeeBps;

  constructor(
    string memory name_,
    string memory symbol_,
    uint8 decimals_
  ) ERC20(name_, symbol_) {
    _customDecimals = decimals_;
  }

  function mint(
    address recipient,
    uint256 amount
  ) external {
    _mint(recipient, amount);
  }

  function setFees(
    uint16 transferFeeBps_,
    uint16 transferFromFeeBps_
  ) external {
    require(transferFeeBps_ <= 10_000, "transfer fee too high");
    require(transferFromFeeBps_ <= 10_000, "transferFrom fee too high");

    _transferFeeBps = transferFeeBps_;
    _transferFromFeeBps = transferFromFeeBps_;
  }

  function transfer(
    address to,
    uint256 value
  ) public override returns (bool) {
    _transferWithFee(_msgSender(), to, value, _transferFeeBps);
    return true;
  }

  function transferFrom(
    address from,
    address to,
    uint256 value
  ) public override returns (bool) {
    _spendAllowance(from, _msgSender(), value);
    _transferWithFee(from, to, value, _transferFromFeeBps);
    return true;
  }

  function decimals() public view override returns (uint8) {
    return _customDecimals;
  }

  function _transferWithFee(
    address from,
    address to,
    uint256 value,
    uint16 feeBps
  ) internal {
    uint256 fee = (value * feeBps) / 10_000;
    uint256 netAmount = value - fee;

    if (fee > 0) {
      _burn(from, fee);
    }

    _transfer(from, to, netAmount);
  }
}
