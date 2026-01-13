// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title VersionManifest
 * @author @kirillinoz
 * @notice A lightweight, immutable snapshot of all contract addresses for a specific version.
 * @dev This contract is what the Beacon points to. Each upgrade deploys a new manifest
 * with updated addresses. No circular dependency because addresses are passed as
 * constructor arguments AFTER all contracts are deployed.
 */
contract VersionManifest {
    /// @notice Error thrown when input arrays have different lengths
    error LengthMismatch();
    /// @notice Error thrown when the manifest is empty
    error EmptyManifest();
    /// @notice Error thrown when an address is the zero address
    error ZeroAddress();
    /// @notice Error thrown when a requested contract is not found
    error ContractNotFound();

    /// @notice The semantic version string of the manifest format itself
    string public constant VERSION = "0.0.2";

    /// @notice The project identifier
    bytes32 public immutable PROJECT_ID;
    /// @notice The human-readable version tag (e.g. "v2.0.0") or IPFS CID
    string public versionTag;
    /// @notice The timestamp when this manifest was deployed
    uint256 public immutable DEPLOYED_AT;

    // Immutable contract addresses for this version
    mapping(string => address) private _contracts;
    string[] private _contractNames;

    /**
     * @notice Creates a new VersionManifest.
     * @param _projectId The project identifier
     * @param _versionTag Human-readable version or IPFS CID
     * @param names Contract names (e.g., ["HubChatRewards", "CeloChatDailyRewards"])
     * @param addresses Contract addresses (must match names order)
     */
    constructor(
        bytes32 _projectId,
        string memory _versionTag,
        string[] memory names,
        address[] memory addresses
    ) {
        if (names.length != addresses.length) revert LengthMismatch();
        if (names.length == 0) revert EmptyManifest();

        PROJECT_ID = _projectId;
        versionTag = _versionTag;
        DEPLOYED_AT = block.timestamp;
        _contractNames = names;

        for (uint256 i = 0; i < names.length; ++i) {
            if (addresses[i] == address(0)) revert ZeroAddress();
            _contracts[names[i]] = addresses[i];
        }
    }

    // --- PUBLIC GETTERS ---

    /// @notice Gets the address of a contract by name.
    /// @param name The name of the contract
    /// @return The address of the contract
    function getContract(string calldata name) external view returns (address) {
        address addr = _contracts[name];
        if (addr == address(0)) revert ContractNotFound();
        return addr;
    }

    /// @notice Gets all contract names and addresses in the manifest.
    /// @return names The list of contract names
    /// @return addresses The list of corresponding contract addresses
    function getAllContracts()
        external
        view
        returns (string[] memory names, address[] memory addresses)
    {
        names = _contractNames;
        addresses = new address[](names.length);
        for (uint256 i = 0; i < names.length; ++i) {
            addresses[i] = _contracts[names[i]];
        }
    }

    /// @notice Gets the list of contract names recorded in the manifest.
    /// @return The list of contract names
    function getContractNames() external view returns (string[] memory) {
        return _contractNames;
    }

    // Convenience getters for chat reward contracts

    /// @notice Gets the address of the HubChatRewards contract.
    /// @return The address of the HubChatRewards contract
    function hubChatRewards() external view returns (address) {
        return _contracts["HubChatRewards"];
    }

    /// @notice Gets the address of the HubChatBaseDailyStreaks contract.
    /// @return The address of the HubChatBaseDailyStreaks contract
    function hubChatBaseDailyStreaks() external view returns (address) {
        return _contracts["HubChatBaseDailyStreaks"];
    }

    /// @notice Gets the address of the CeloChatDailyRewards contract.
    /// @return The address of the CeloChatDailyRewards contract
    function celoChatDailyRewards() external view returns (address) {
        return _contracts["CeloChatDailyRewards"];
    }
}
