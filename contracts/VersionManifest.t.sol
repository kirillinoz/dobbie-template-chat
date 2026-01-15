// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {VersionManifest} from "./VersionManifest.sol";

contract VersionManifestTest is Test {
    VersionManifest public manifest;
    bytes32 public projectId;
    string public versionTag;
    string[] public names;
    address[] public addresses;

    function setUp() public {
        projectId = keccak256(abi.encodePacked("test-project"));
        versionTag = "v1.0.0";

        names.push("ContractA");
        names.push("ContractB");
        names.push("HubChatRewards");

        addresses.push(address(0xA));
        addresses.push(address(0xB));
        addresses.push(address(0xC));

        manifest = new VersionManifest(projectId, versionTag, names, addresses);
    }

    function test_Constants() public view {
        assertEq(manifest.VERSION(), "0.0.2");
    }

    function test_PublicVariables() public view {
        assertEq(manifest.versionTag(), versionTag);
    }

    function test_GetContract() public view {
        address addrA = manifest.getContract("ContractA");
        assertEq(addrA, addresses[0]);

        address addrB = manifest.getContract("ContractB");
        assertEq(addrB, addresses[1]);
    }

    function test_GetAllContracts() public view {
        (string[] memory allNames, address[] memory allAddresses) = manifest
            .getAllContracts();

        assertEq(allNames.length, names.length);
        assertEq(allAddresses.length, addresses.length);

        for (uint i = 0; i < names.length; i++) {
            assertEq(allNames[i], names[i]);
            assertEq(allAddresses[i], addresses[i]);
        }
    }

    function test_GetContractNames() public view {
        string[] memory storedNames = manifest.getContractNames();
        assertEq(storedNames.length, names.length);
        for (uint i = 0; i < names.length; i++) {
            assertEq(storedNames[i], names[i]);
        }
    }

    function test_HubChatRewardsConvenienceGetter() public view {
        address hubChatRewardsAddr = manifest.hubChatRewards();
        assertEq(hubChatRewardsAddr, addresses[2]);
    }
}
