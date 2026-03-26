// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.30;

import { Script, console2 } from "lib/openzeppelin-contracts/lib/forge-std/src/Script.sol";

import { MegaMppSessionEscrow } from "../src/MegaMppSessionEscrow.sol";

contract UpgradeMegaMppSessionEscrowScript is Script {
  function run() external returns (address proxyAddress, address implementationAddress) {
    uint256 ownerPrivateKey = vm.envUint("PRIVATE_KEY");
    address proxy = vm.envAddress("SESSION_ESCROW_PROXY");

    vm.startBroadcast(ownerPrivateKey);

    MegaMppSessionEscrow implementation = new MegaMppSessionEscrow();
    MegaMppSessionEscrow(payable(proxy)).upgradeToAndCall(address(implementation), bytes(""));

    vm.stopBroadcast();

    proxyAddress = proxy;
    implementationAddress = address(implementation);

    console2.log("MegaMppSessionEscrow upgraded proxy:", proxyAddress);
    console2.log("MegaMppSessionEscrow new implementation:", implementationAddress);
  }
}
