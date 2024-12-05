// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts-0.8/security/ReentrancyGuard.sol";
import { KeeperRole } from "../peripheral/KeeperRole.sol";
import { Module } from "./Module.sol";

/**Ø
 * @author  Aura Finance
 * @notice  This module allows a keeper to claim from chef forwarder and deposit bribes into authorized proposals
 */
contract HHChefClaimBriberModule is Module, KeeperRole, ReentrancyGuard {
    /// @dev Epoch duration
    uint256 public constant EPOCH_DURATION = 2 weeks;

    /// @notice The cvx token address
    address public immutable cvx;

    /// @notice The Hidden Hand bribe vault address
    address public immutable bribeVault;

    /// @notice The chefForwarder addresses
    address public immutable chefForwarder;

    /// @dev How much total reward per epoch
    uint256 public rewardPerEpoch;

    /// @notice The authorized proposals
    mapping(bytes32 => bool) public authorizedProposals;

    /// @notice The authorized markets
    mapping(address => bool) public authorizedMarkets;

    /// @dev Epoch => total amount
    mapping(uint256 => uint256) public getTotalAmount;

    struct Bribe {
        address market;
        bytes32 proposal;
        uint256 amount;
        uint256 maxTokenPerVote;
        uint256 periods;
    }

    /* -------------------------------------------------------------------
       Events 
    ------------------------------------------------------------------- */

    event SetRewardPerEpoch(uint256 rewardPerEpoch);
    event SetAuthorizedProposal(bytes32 proposal, bool authorized);
    event SetAuthorizedMarket(address market, bool authorized);

    /**
     * @notice  Constructor for the HHChefClaimBriberModule
     * @param _owner        Owner of the contract
     * @param _safeWallet   Address of the Safe
     * @param _cvx   The address of the CRV token
     * @param _chefForwarder The address of the chef forwarder
     * @param _bribeVault   The address of the bribe vault
     */
    constructor(
        address _owner,
        address _safeWallet,
        address _cvx,
        address _chefForwarder,
        address _bribeVault
    ) KeeperRole(_owner) Module(_safeWallet) {
        cvx = _cvx;
        chefForwarder = _chefForwarder;
        bribeVault = _bribeVault;
    }

    /* -------------------------------------------------------------------
       OnlyOwner 
    ------------------------------------------------------------------- */

    /**
     * @notice  Update the authorized proposals
     * @dev     Only callable by the owner
     * @param _proposal  The proposal hash
     * @param _authorized  Whether the proposal is authorized
     */
    function updateAuthorizedProposals(bytes32 _proposal, bool _authorized) external onlyOwner {
        authorizedProposals[_proposal] = _authorized;
        emit SetAuthorizedProposal(_proposal, _authorized);
    }

    /**
     * @notice  Update the authorized markets
     * @dev     Only callable by the owner
     * @param _market  The market address
     * @param _authorized  Whether the proposal is authorized
     */
    function updateAuthorizedMarkets(address _market, bool _authorized) external onlyOwner {
        authorizedMarkets[_market] = _authorized;
        emit SetAuthorizedMarket(_market, _authorized);
    }

    /**
     * @dev Set number of rewards per epoch
     * @param _rewardPerEpoch Reward per epoch
     */
    function setRewardPerEpoch(uint256 _rewardPerEpoch) external onlyOwner {
        rewardPerEpoch = _rewardPerEpoch;
        emit SetRewardPerEpoch(_rewardPerEpoch);
    }

    /**
     * @notice  Get the current epoch
     * @dev     see constant EPOCH_DURATION
     * @return uint256  The current epoch
     */
    function getCurrentEpoch() internal view returns (uint256) {
        return block.timestamp / EPOCH_DURATION;
    }

    /**
     * @notice  Claim from chef forwarder
     * @return cvxClaimed  The amount of CVX claimed
     */
    function _claimFromChefForwarder() private returns (uint256 cvxClaimed) {
        uint256 cvxInitialBalance = IERC20(cvx).balanceOf(address(safeWallet));
        _execCallFromModule(chefForwarder, abi.encodeWithSignature("claim(address)", cvx));
        cvxClaimed = IERC20(cvx).balanceOf(address(safeWallet)) - cvxInitialBalance;
    }

    /* -------------------------------------------------------------------
       Keeper 
    ------------------------------------------------------------------- */
    /**
     * @notice  Claim from chef forwarder.
     * @dev     Only callable by a keeper
     */
    function claimFromChef() external onlyKeeper {
        _claimFromChefForwarder();
    }

    /**
     * @notice  Claim from the vesting streams and deposit bribes
     * @dev     Only callable by a keeper, the total amount can not be greater than the
     *          amount claimed from the vesting streams, the proposals must be authorized.
     *
     * @param bribes  Array of the bribes to deposit
     * @return bool
     */
    function depositBribes(Bribe[] calldata bribes) external onlyKeeper nonReentrant returns (bool) {
        uint256 epoch = getCurrentEpoch();
        require(getTotalAmount[epoch] == 0, "already claimed");

        uint256 len = bribes.length;
        uint256 totalAmount = 0;

        for (uint256 i = 0; i < len; i++) {
            totalAmount = totalAmount + bribes[i].amount;
        }

        // Validate the total amount does not exceed the reward per epoch see AIP-63
        require(rewardPerEpoch >= totalAmount, "!totalAmount");
        getTotalAmount[epoch] = totalAmount;

        _execCallFromModule(cvx, abi.encodeWithSignature("approve(address,uint256)", bribeVault, totalAmount));

        for (uint256 i = 0; i < len; i++) {
            require(authorizedProposals[bribes[i].proposal], "!proposals");
            require(authorizedMarkets[bribes[i].market], "!markets");
            require(bribes[i].periods == 1 || bribes[i].periods == 2, "!period");

            _execCallFromModule(
                bribes[i].market,
                abi.encodeWithSignature(
                    "depositBribe(bytes32,address,uint256,uint256,uint256)",
                    bribes[i].proposal,
                    cvx,
                    bribes[i].amount,
                    bribes[i].maxTokenPerVote,
                    bribes[i].periods
                )
            );
        }
        return true;
    }
}
