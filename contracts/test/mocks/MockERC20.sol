// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.30;

import {ERC20} from "lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private immutable _customDecimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _customDecimals = decimals_;
    }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }

    function decimals() public view override returns (uint8) {
        return _customDecimals;
    }
}
