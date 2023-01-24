// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IAuraBribe {
    function BRIBE_VAULT() external view returns (address);

    function DEFAULT_ADMIN_ROLE() external view returns (bytes32);

    function PROTOCOL() external view returns (bytes32);

    function TEAM_ROLE() external view returns (bytes32);

    function addWhitelistTokens(address[] calldata tokens) external;

    function allWhitelistedTokens(uint256) external view returns (address);

    function depositBribe(bytes32 proposal) external;

    function depositBribeERC20(
        bytes32 proposal,
        address token,
        uint256 amount
    ) external;

    function generateBribeVaultIdentifier(
        bytes32 proposal,
        uint256 proposalDeadline,
        address token
    ) external view returns (bytes32 identifier);

    function generateRewardIdentifier(uint256 proposalDeadline, address token)
        external
        view
        returns (bytes32 identifier);

    function getBribe(
        bytes32 proposal,
        uint256 proposalDeadline,
        address token
    ) external view returns (address bribeToken, uint256 bribeAmount);

    function getRoleAdmin(bytes32 role) external view returns (bytes32);

    function getWhitelistedTokens() external view returns (address[] memory);

    function grantRole(bytes32 role, address account) external;

    function grantTeamRole(address teamMember) external;

    function hasRole(bytes32 role, address account) external view returns (bool);

    function indexOfWhitelistedToken(address) external view returns (uint256);

    function isWhitelistedToken(address token) external view returns (bool);

    function proposalDeadlines(bytes32) external view returns (uint256);

    function removeWhitelistTokens(address[] calldata tokens) external;

    function renounceRole(bytes32 role, address account) external;

    function revokeRole(bytes32 role, address account) external;

    function revokeTeamRole(address teamMember) external;

    function rewardForwarding(address) external view returns (address);

    function setProposalChoices(
        uint256 proposalIndex,
        uint256 choiceCount,
        uint256 deadline
    ) external;

    function setRewardForwarding(address to) external;

    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}
