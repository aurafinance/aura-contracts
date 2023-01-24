// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;
pragma experimental ABIEncoderV2;

interface IHHRewardDistributor {
    struct Reward {
        address token;
        bytes32 merkleRoot;
        bytes32 proof;
        uint256 updateCount;
    }

    struct Claim {
        bytes32 identifier;
        address account;
        uint256 amount;
        bytes32[] merkleProof;
    }

    function BRIBE_VAULT() external view returns (address);

    function DEFAULT_ADMIN_ROLE() external view returns (bytes32);

    function claim(Claim[] memory _claims) external;

    function claimed(bytes32, address) external view returns (uint256);

    function getRoleAdmin(bytes32 role) external view returns (bytes32);

    function grantRole(bytes32 role, address account) external;

    function hasRole(bytes32 role, address account) external view returns (bool);

    function renounceRole(bytes32 role, address account) external;

    function revokeRole(bytes32 role, address account) external;

    function rewards(bytes32)
        external
        view
        returns (
            address token,
            bytes32 merkleRoot,
            bytes32 proof,
            uint256 updateCount
        );

    function supportsInterface(bytes4 interfaceId) external view returns (bool);

    function updateRewardsMetadata(Reward[] memory _distributions) external;
}
