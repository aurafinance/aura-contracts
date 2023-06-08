// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IBalancerVault, IAsset } from "../../interfaces/balancer/IBalancerCore.sol";
import { IFeeDistributor } from "../../interfaces/balancer/IFeeDistributor.sol";
import { IBalGaugeController } from "../../interfaces/balancer/IBalGaugeController.sol";
import { IVotingEscrow } from "../../interfaces/balancer/IVotingEscrow.sol";
import { AuraMath } from "../../utils/AuraMath.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

/**
 * @title   AuraArbBalGrant
 * @author  AuraFinance
 * @notice  An escrow contract for the BAL grant provided to projects
 */
contract AuraArbBalGrant {
    using SafeERC20 for IERC20;
    using AuraMath for uint256;

    /* ----------------------------------------------------------------
       Storage 
    ---------------------------------------------------------------- */

    IERC20 public immutable ARB;
    IERC20 public immutable BAL;
    IERC20 public AURA;

    address public immutable PROJECT;
    address public immutable BALANCER;

    uint256 public constant COOLDOWN_PERIOD = 60 days;
    uint256 public cooldownStart;

    IBalancerVault public immutable BALANCER_VAULT;
    bytes32 public POOL_ID;
    address[] public poolTokens;

    /* ----------------------------------------------------------------
       Events 
    ---------------------------------------------------------------- */

    event StartCooldown(uint256 startTimestamp, uint256 endTimestamp);
    event WithdrawBalances(uint256 auraBalance, uint256 balBalance, uint256 arbBalance);

    /* ----------------------------------------------------------------
       Constructor 
    ---------------------------------------------------------------- */

    /**
     * @param _arb              ARB token
     * @param _bal              BAL token
     * @param _project          the multisig that manages the project  functions
     * @param _balancer         the multisig that manages the balancer functions
     * @param _balancerVault    core balancer vault
     */
    constructor(
        IERC20 _arb,
        IERC20 _bal,
        address _project,
        address _balancer,
        IBalancerVault _balancerVault
    ) {
        ARB = _arb;
        BAL = _bal;
        PROJECT = _project;
        BALANCER = _balancer;
        BALANCER_VAULT = _balancerVault;
    }

    /* ----------------------------------------------------------------
       Modifiers 
    ---------------------------------------------------------------- */

    /**
     * @notice Modifier that allows only Project or Balancer can trigger a function
     */
    modifier onlyAuth() {
        require(msg.sender == PROJECT || msg.sender == BALANCER, "!auth");
        _;
    }

    /**
     * @notice Modifier that allows only Balancer to trigger a function
     */
    modifier onlyBalancer() {
        require(msg.sender == BALANCER, "!balancer");
        _;
    }

    /**
     * @notice Modifier that only allows something to be called when the contract is inactive
     */
    modifier whileInactive() {
        require(cooldownStart != 0 && block.timestamp > cooldownStart + COOLDOWN_PERIOD, "active");
        _;
    }

    /**
     * @notice Modifier that only allows something to be called when the contract is active
     */
    modifier whileActive() {
        require(cooldownStart == 0, "!active");
        _;
    }

    /* ----------------------------------------------------------------
       Init 
    ---------------------------------------------------------------- */

    /**
     * @dev Initialize the contract values
     * @param _aura        AURA token
     * @param _poolId      poolID of the 8020 pool
     */
    function init(IERC20 _aura, bytes32 _poolId) external onlyAuth {
        require(address(AURA) == address(0), "already initialized");

        AURA = _aura;
        POOL_ID = _poolId;

        (address[] memory _poolTokens, , ) = BALANCER_VAULT.getPoolTokens(_poolId);
        for (uint256 i = 0; i < _poolTokens.length; i++) {
            poolTokens.push(_poolTokens[i]);
        }

        _aura.safeApprove(address(BALANCER_VAULT), type(uint256).max);
        BAL.safeApprove(address(BALANCER_VAULT), type(uint256).max);
        ARB.safeApprove(address(BALANCER_VAULT), type(uint256).max);
    }

    /* ----------------------------------------------------------------
       Shared Functions
    ---------------------------------------------------------------- */

    /**
     * @notice Sends BAL and ARB to balancer and AURA to project
     * @dev grant must be inactive in order for this to be called
     */
    function withdrawBalances() external onlyAuth whileInactive {
        // Send AURA to project msig
        uint256 auraBalance = AURA.balanceOf(address(this));
        AURA.safeTransfer(PROJECT, auraBalance);
        // Send BAL and ARB to balancer msig
        uint256 balBalance = BAL.balanceOf(address(this));
        BAL.safeTransfer(BALANCER, balBalance);
        uint256 arbBalance = ARB.balanceOf(address(this));
        ARB.safeTransfer(BALANCER, arbBalance);

        emit WithdrawBalances(auraBalance, balBalance, arbBalance);
    }

    /**
     * @notice Join the pool
     * @dev Only callable by an authenticated party
     * @dev Only callable when active
     * @param _minAmountOut Min amount of BPT to get out
     */
    function join(uint256 _minAmountOut) external onlyAuth whileActive {
        _joinPool(_minAmountOut);
    }

    /**
     * @notice Allows auth to start cooldown timer
     */
    function startCooldown() external onlyAuth whileActive {
        cooldownStart = block.timestamp;
        emit StartCooldown(block.timestamp, block.timestamp + COOLDOWN_PERIOD);
    }

    /* ----------------------------------------------------------------
       Balancer Functions 
    ---------------------------------------------------------------- */

    /**
     * @notice exits BPT position
     * grant must be inactive in order for this to be called
     * @param  _minOuts Min out amounts
     */
    function exit(uint256[] memory _minOuts) external onlyBalancer whileInactive {
        _exitPool(_minOuts);
    }

    /* ----------------------------------------------------------------
       Internal Functions 
    ---------------------------------------------------------------- */

    /**
     * @notice Get array of pool assets in the correct order
     */
    function _getAssetArray() internal view returns (IAsset[] memory) {
        uint256 len = poolTokens.length;
        IAsset[] memory assets = new IAsset[](len);
        for (uint256 i = 0; i < len; i++) {
            address poolToken = poolTokens[i];
            assets[i] = IAsset(poolToken);
        }
        return assets;
    }

    /**
     * @notice deposits contract AURA, BAL and ARB balances for BPT tokens
     * @param  _minAmountOut slippage check for BPT output
     */
    function _joinPool(uint256 _minAmountOut) internal {
        IAsset[] memory assets = _getAssetArray();
        uint256[] memory maxAmountsIn = new uint256[](assets.length);

        for (uint256 i = 0; i < assets.length; i++) {
            maxAmountsIn[i] = IERC20(address(assets[i])).balanceOf(address(this));
        }

        BALANCER_VAULT.joinPool(
            POOL_ID,
            address(this),
            address(this),
            IBalancerVault.JoinPoolRequest(
                assets,
                maxAmountsIn,
                abi.encode(IBalancerVault.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT, maxAmountsIn, _minAmountOut),
                false // Don't use internal balances
            )
        );
    }

    /**
     * @notice withdraws BAL, AURA and ARB from BPT position
     * @param  _minOuts Min out slippage checks for output
     */
    function _exitPool(uint256[] memory _minOuts) internal {
        IAsset[] memory assets = _getAssetArray();

        (address bpt, ) = BALANCER_VAULT.getPool(POOL_ID);
        uint256 bptBalance = IERC20(bpt).balanceOf(address(this));

        BALANCER_VAULT.exitPool(
            POOL_ID,
            address(this),
            payable(address(this)),
            IBalancerVault.ExitPoolRequest(
                assets,
                _minOuts,
                abi.encode(IBalancerVault.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT, bptBalance),
                false // Don't use internal balances
            )
        );
    }
}
