// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.30;

import {Script, console2} from "lib/openzeppelin-contracts/lib/forge-std/src/Script.sol";
import {ERC1967Proxy} from "lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {MegaMppSessionEscrow} from "../src/MegaMppSessionEscrow.sol";

contract DeployMegaMppSessionEscrowScript is Script {
    function run() external returns (address proxyAddress, address implementationAddress) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address owner = vm.envAddress("SESSION_ESCROW_OWNER");
        uint64 closeDelaySeconds = uint64(vm.envUint("SESSION_ESCROW_CLOSE_DELAY"));

        vm.startBroadcast(deployerPrivateKey);

        MegaMppSessionEscrow implementation = new MegaMppSessionEscrow();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(implementation),
            abi.encodeCall(MegaMppSessionEscrow.initialize, (owner, closeDelaySeconds))
        );

        vm.stopBroadcast();

        proxyAddress = address(proxy);
        implementationAddress = address(implementation);

        console2.log("MegaMppSessionEscrow implementation:", implementationAddress);
        console2.log("MegaMppSessionEscrow proxy:", proxyAddress);
    }
}
