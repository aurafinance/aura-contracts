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
    IBalancerVault public immutable BALANCER_VAULT;
    address public immutable project;
    address public immutable balancer;

    IERC20 public AURA;
    IERC20 public BPT;
    bytes32 public POOL_ID;
    bool public active;

    uint256[3] public tokenOrder;

    /* ----------------------------------------------------------------
       Constructor 
    ---------------------------------------------------------------- */

    /**
     * @param _arb              ARB token
     * @param _bal              BAL token
     * @param _balancerVault    core balancer vault
     * @param _project          the multisig that manages the project  functions
     * @param _balancer         the multisig that manages the balancer functions
     */
    constructor(
        IERC20 _arb,
        IERC20 _bal,
        IBalancerVault _balancerVault,
        address _project,
        address _balancer
    ) {
        ARB = _arb;
        BAL = _bal;
        BALANCER_VAULT = _balancerVault;
        project = _project;
        balancer = _balancer;
    }

    /* ----------------------------------------------------------------
       Modifiers 
    ---------------------------------------------------------------- */

    /**
     * @notice Modifier that allows only Project or Balancer can trigger a function
     */
    modifier onlyAuth() {
        require(msg.sender == project || msg.sender == balancer, "!auth");
        _;
    }

    /**
     * @notice Modifier that allows only Balancer to trigger a function
     */
    modifier onlyBalancer() {
        require(msg.sender == balancer, "!balancer");
        _;
    }

    /**
     * @notice Modifier that only allows something to be called when the contract is inactive
     */
    modifier whileInactive() {
        require(!active, "active");
        _;
    }

    /**
     * @notice Modifier that only allows something to be called when the contract is active
     */
    modifier whileActive() {
        require(active, "!active");
        _;
    }

    /* ----------------------------------------------------------------
       Init 
    ---------------------------------------------------------------- */

    /**
     * @dev Initialise the contract values
     * @param _aura        AURA token
     * @param _bpt         BPT token
     * @param _poolId      poolID of the 8020 pool
     * @param _tokenOrder  Order of AURA, BAL, ARB in the pool
     */
    function init(
        IERC20 _aura,
        IERC20 _bpt,
        bytes32 _poolId,
        uint256[3] memory _tokenOrder
    ) external onlyAuth {
        require(address(AURA) == address(0), "already initialized");

        AURA = _aura;
        BPT = _bpt;
        POOL_ID = _poolId;

        for (uint256 i; i < 3; i++) {
            tokenOrder[i] = _tokenOrder[i];
        }

        active = true;

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
        AURA.safeTransfer(project, AURA.balanceOf(address(this)));
        // Send BAL and ARB to balancer msig
        BAL.safeTransfer(balancer, BAL.balanceOf(address(this)));
        ARB.safeTransfer(balancer, ARB.balanceOf(address(this)));
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
     * @notice exits BPT position
     * grant must be inactive in order for this to be called
     * @param  _minOuts Min out amounts
     */
    function exit(uint256[3] memory _minOuts) external onlyAuth whileInactive {
        _exitPool(_minOuts);
    }

    /* ----------------------------------------------------------------
       Balancer Functions 
    ---------------------------------------------------------------- */

    /**
     * @notice Allows balancer to change the state of the grant
     * @param _active the new grant state
     */
    function setActive(bool _active) external onlyBalancer {
        active = _active;
    }

    /* ----------------------------------------------------------------
       Internal Functions 
    ---------------------------------------------------------------- */

    /**
     * @notice Get array of pool assets in the correct order
     */
    function _getAssetArray() internal view returns (IERC20[3] memory assets) {
        IERC20[3] memory unordered = [ARB, AURA, BAL];
        for (uint256 i = 0; i < 3; i++) {
            assets[tokenOrder[i]] = unordered[i];
        }
    }

    /**
     * @notice deposits contract AURA, BAL and ARB balances for BPT tokens
     * @param  _minAmountOut slippage check for BPT output
     */
    function _joinPool(uint256 _minAmountOut) internal {
        IAsset[] memory assets = new IAsset[](3);
        uint256[] memory maxAmountsIn = new uint256[](3);
        IERC20[3] memory assetArr = _getAssetArray();

        for (uint256 i = 0; i < 3; i++) {
            IERC20 asset = assetArr[i];
            assets[i] = IAsset(address(asset));
            maxAmountsIn[i] = asset.balanceOf(address(this));
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
    function _exitPool(uint256[3] memory _minOuts) internal {
        IAsset[] memory assets = new IAsset[](3);
        uint256[] memory minAmountsOut = new uint256[](3);
        IERC20[3] memory assetArr = _getAssetArray();

        for (uint256 i = 0; i < 3; i++) {
            IERC20 asset = assetArr[i];
            assets[i] = IAsset(address(asset));
            minAmountsOut[i] = _minOuts[i];
        }

        uint256 bptBalance = BPT.balanceOf(address(this));

        BALANCER_VAULT.exitPool(
            POOL_ID,
            address(this),
            payable(address(this)),
            IBalancerVault.ExitPoolRequest(
                assets,
                minAmountsOut,
                abi.encode(IBalancerVault.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT, bptBalance),
                false // Don't use internal balances
            )
        );
    }
}
