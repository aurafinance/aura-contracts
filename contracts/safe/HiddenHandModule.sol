// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { KeeperRole } from "../peripheral/KeeperRole.sol";
import { Module } from "./Module.sol";

/**Ø
 * @author  Aura Finance
 * @notice  This module allows a keeper to claim from vesting streams and deposit bribes into authorized proposals
 */
contract HiddenHandsModule is Module, KeeperRole {
    /// @notice The CRV token address
    address public immutable cvx;
    /// @notice The Hidden Hand bribe vault address
    address public immutable bribeVault;
    /// @notice The Hidden Hand bribe market address
    address public immutable bribeMarket;

    /// @notice The the vesting streams addresses
    address[] public vestingStreams;
    /// @notice The authorized proposals
    mapping(bytes32 => bool) public authorizedProposals;

    /**
     * @notice  Constructor for the HiddenHandsModule
     * @param _owner        Owner of the contract
     * @param _safeWallet   Address of the Safe
     * @param _cvx   The address of the CRV token
     * @param _bribeVault   The address of the bribe vault
     * @param _bribeMarket  The address of the bribe market
     */
    constructor(
        address _owner,
        address _safeWallet,
        address _cvx,
        address _bribeVault,
        address _bribeMarket
    ) KeeperRole(_owner) Module(_safeWallet) {
        cvx = _cvx;
        bribeMarket = _bribeMarket;
        bribeVault = _bribeVault;
    }

    /**
     * @notice  Update the authorized proposals
     * @dev     Only callable by the owner
     * @param proposal  The proposal hash
     * @param _authorized  Whether the proposal is authorized
     */
    function updateAuthorizedProposals(bytes32 proposal, bool _authorized) external onlyOwner {
        authorizedProposals[proposal] = _authorized;
    }

    /**
     * @notice  Set the vesting streams
     * @dev     Only callable by the owner
     * @param _vestingStreams  Array of the vesting streams
     */
    function setVestingStreams(address[] calldata _vestingStreams) external onlyOwner {
        vestingStreams = _vestingStreams;
    }

    /**
     * @notice  Claim from the vesting streams
     * @return cvxClaimed  The amount of CVX claimed
     */
    function _claimFromVestingStreams() private returns (uint256 cvxClaimed) {
        uint256 cvxInitialBalance = IERC20(cvx).balanceOf(address(safeWallet));
        uint256 len = vestingStreams.length;
        for (uint256 i = 0; i < len; i++) {
            _execCallFromModule(vestingStreams[i], abi.encodeWithSignature("claim(bool)", false));
        }
        cvxClaimed = IERC20(cvx).balanceOf(address(safeWallet)) - cvxInitialBalance;
    }

    /**
     * @notice  Claim from the vesting streams and deposit bribes
     * @dev     Only callable by a keeper, the total amount can not be greater than the
     *          amount claimed from the vesting streams, the proposals must be authorized.
     *
     * @param proposals         Array of the proposal hashes
     * @param amounts           Array of the amounts to deposit
     * @param maxTokenPerVotes  Array of the max token per votes
     * @return bool
     */
    function claimVestingAndDepositBribes(
        bytes32[] memory proposals,
        uint256[] memory amounts,
        uint256[] memory maxTokenPerVotes
    ) external onlyKeeper returns (bool) {
        uint256 len = proposals.length;
        require(len == amounts.length, "!length");
        require(len == maxTokenPerVotes.length, "!length");
        // Claim from vesting streams
        uint256 cvxClaimed = _claimFromVestingStreams();
        uint256 totalAmount = 0;

        for (uint256 i = 0; i < len; i++) {
            totalAmount = totalAmount + amounts[i];
        }
        require(cvxClaimed >= totalAmount, "!totalAmount");

        _execCallFromModule(cvx, abi.encodeWithSignature("approve(address,uint256)", bribeVault, totalAmount));

        for (uint256 i = 0; i < len; i++) {
            require(authorizedProposals[proposals[i]], "!proposals");

            _execCallFromModule(
                bribeMarket,
                abi.encodeWithSignature(
                    "depositBribe(bytes32,address,uint256,uint256,uint256)",
                    proposals[i],
                    cvx,
                    amounts[i],
                    maxTokenPerVotes[i],
                    1 // Periods
                )
            );
        }
        return true;
    }
}
