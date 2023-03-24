// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IBalancerVault, IPriceOracle, IAsset } from "../../interfaces/balancer/IBalancerCore.sol";
import { IFeeDistributor } from "../../interfaces/balancer/IFeeDistributor.sol";
import { IBalGaugeController } from "../../interfaces/balancer/IBalGaugeController.sol";
import { IVotingEscrow } from "../../interfaces/balancer/IVotingEscrow.sol";
import { AuraMath } from "../../utils/AuraMath.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

/**
 * @title   VeBalGrant
 * @author  AuraFinance
 * @notice  An escrow contract for the BAL grant provided to projects
 * @dev     Allows projects
 */
contract VeBalGrant {
    using SafeERC20 for IERC20;
    using AuraMath for uint256;

    /* ----------------------------------------------------------------
       Storage 
    ---------------------------------------------------------------- */

    IERC20 public immutable WETH;
    IERC20 public immutable BAL;
    IERC20 public immutable BAL_ETH_BPT;
    IVotingEscrow public immutable votingEscrow;
    IBalGaugeController public immutable gaugeController;
    address public immutable project;
    address public immutable balancer;
    IBalancerVault public immutable BALANCER_VAULT;
    bytes32 public immutable BAL_ETH_POOL_ID;
    bool public active;
    uint256 public ethContributed;

    /* ----------------------------------------------------------------
       Constructor 
    ---------------------------------------------------------------- */

    /**
     * @param _weth               Weth token
     * @param _bal                Bal token
     * @param _balEthBpt          80BAL:20WETH BPT token
     * @param _votingEscrow       voting escrow contract for 8020 locking
     * @param _gaugeController    gaugeController
     * @param _project            the multisig that manages the project  functions
     * @param _balancer           the multisig that manages the balancer functions
     * @param _balancerVault      core balancer vault
     * @param _balETHPoolId       poolID of the 8020 pool
     */
    constructor(
        address _weth,
        address _bal,
        address _balEthBpt,
        address _votingEscrow,
        address _gaugeController,
        address _project,
        address _balancer,
        IBalancerVault _balancerVault,
        bytes32 _balETHPoolId
    ) {
        WETH = IERC20(_weth);
        BAL = IERC20(_bal);
        BAL_ETH_BPT = IERC20(_balEthBpt);
        votingEscrow = IVotingEscrow(_votingEscrow);
        gaugeController = IBalGaugeController(_gaugeController);
        project = _project;
        balancer = _balancer;
        BALANCER_VAULT = _balancerVault;
        BAL_ETH_POOL_ID = _balETHPoolId;
        active = true;

        //Approvals
        WETH.safeApprove(address(BALANCER_VAULT), type(uint256).max);
        BAL.safeApprove(address(BALANCER_VAULT), type(uint256).max);
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
     * @notice Modifier that allows only Project to trigger a function
     */
    modifier onlyProject() {
        require(msg.sender == project, "!project");
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
     * @notice Modifier that allows project to trigger a function if active or balancer if inactive,
     */
    modifier onlyCurrentParty() {
        require(msg.sender == (active ? project : balancer), "!caller");
        _;
    }

    /**
     * @notice Modifier that only allows something to be called when the contract is active
     */
    modifier whileActive() {
        require(active, "!active");
        _;
    }

    /**
     * @notice Modifier that only allows something to be called when the contract is inactive
     */
    modifier whileInactive() {
        require(!active, "active");
        _;
    }

    /* ----------------------------------------------------------------
       Shared Functions
    ---------------------------------------------------------------- */

    /**
     * @notice Releases veBAL lock
     * grant must be inactive in order for this to be called
     */
    function release() external onlyAuth whileInactive {
        votingEscrow.withdraw();
    }

    /**
     * @notice exits BPT position in return for WETH and BAL
     * grant must be inactive in order for this to be called
     * @param  _minBalOut  slippage check for Bal output
     * @param  _minWethOut slippage check for Weth output
     */
    function redeem(uint256 _minBalOut, uint256 _minWethOut) external onlyAuth whileInactive {
        _exitBalEthPool(_minBalOut, _minWethOut);
    }

    /**
     * @notice Sends WETH and BAL to project and balancer
     * Project gets WETH up to the amount they contributed in the initial lock
     * Balancer gets all BAL and any remaining WETH
     * grant must be inactive in order for this to be called
     */
    function withdrawBalances() external onlyAuth whileInactive {
        uint256 _wethBalance = WETH.balanceOf(address(this));
        uint256 wethForProjectBalance = AuraMath.min(ethContributed, _wethBalance);
        ethContributed = 0;
        WETH.safeTransfer(project, wethForProjectBalance);
        WETH.safeTransfer(balancer, _wethBalance - wethForProjectBalance);
        BAL.safeTransfer(balancer, BAL.balanceOf(address(this)));
    }

    /**
     * @notice Allows Balancer or Project to vote for a gauge
     * @param gauge      gauge that will be voted for
     * @param weight     vote weight
     */
    function voteGaugeWeight(address gauge, uint256 weight) external onlyCurrentParty {
        gaugeController.vote_for_gauge_weights(gauge, weight);
    }

    /**
     * @notice Allows Balancer or Project to call other contracts via the grant
     * @notice some addresses and function selectors are barred from being called
     * @param _to      Target Contract
     * @param _value   Eth to be sent
     * @param _data    Call data
     */
    function execute(
        address _to,
        uint256 _value,
        bytes memory _data
    ) external onlyCurrentParty returns (bool, bytes memory) {
        require(
            _to != address(WETH) && _to != address(BAL) && _to != address(BAL_ETH_BPT) && _to != address(votingEscrow),
            "invalid target"
        );

        bytes4 sig;
        assembly {
            sig := mload(add(_data, 32))
        }

        require(sig != IFeeDistributor.claimToken.selector && sig != IFeeDistributor.claimTokens.selector, "!allowed");

        (bool success, bytes memory result) = _to.call{ value: _value }(_data);
        require(success, "!success");
        return (success, result);
    }

    /* ----------------------------------------------------------------
       Project Functions
    ---------------------------------------------------------------- */

    /**
     * @notice Increase amount locked in veBAL using BPT balance of contract
     * @notice Only the project may call this while the grant is active
     * @param  _amount number of BPT tokens to lock
     */
    function increaseLock(uint256 _amount) public onlyProject whileActive {
        _increaseLock(_amount);
    }

    /**
     * @notice Increase veBAL lock time
     * @notice Only the project may call this while the grant is active
     * @param  _to the new unlock time
     */
    function increaseTime(uint256 _to) external onlyProject whileActive {
        votingEscrow.increase_unlock_time(_to);
    }

    /**
     * @notice claim fees from distributor
     * @notice Locks as BPT if the fee is bal or weth
     * @notice Sends if token is not weth or bal
     * @notice Only the project may call this while the grant is active
     * @param  _feeDistributor fee distributor being called
     * @param  _token token being claimed from distributor
     * @param  _to receiver in the send situation
     * @param  _minAmountOut slippage check for BPT output
     */
    function claimFees(
        address _feeDistributor,
        address _token,
        address _to,
        uint256 _minAmountOut
    ) external onlyProject whileActive {
        IFeeDistributor(_feeDistributor).claimToken(address(this), IERC20(_token));

        if (_token == address(BAL) || _token == address(WETH)) {
            _joinBalEthPool(_minAmountOut);
            uint256 _balance = BAL_ETH_BPT.balanceOf(address(this));
            _increaseLock(_balance);
        } else {
            require(_to != address(0), "!0");
            IERC20(_token).safeTransfer(_to, IERC20(_token).balanceOf(address(this)));
        }
    }

    /**
     * @notice creates the initial lock for the grant
     * @notice tracks lock state and weth contributed by project
     * @notice Only the project may call this while the grant is active
     * @param  _unlockTime When the lock will be lifted
     */
    function createLock(uint256 _unlockTime, uint256 _minAmountOut) external onlyProject whileActive {
        _joinBalEthPool(_minAmountOut);
        uint256 balance = BAL_ETH_BPT.balanceOf(address(this));
        BAL_ETH_BPT.safeApprove(address(votingEscrow), balance);
        votingEscrow.create_lock(balance, _unlockTime);
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
     * @notice deposits contract WETH and BAL balances for BPT tokens
     * @param  _minAmountOut slippage check for BPT output
     */
    function _joinBalEthPool(uint256 _minAmountOut) internal {
        uint256 _wethBalance = WETH.balanceOf(address(this));
        IAsset[] memory assets = new IAsset[](2);
        assets[0] = IAsset(address(BAL));
        assets[1] = IAsset(address(WETH));
        uint256[] memory maxAmountsIn = new uint256[](2);
        maxAmountsIn[0] = BAL.balanceOf(address(this));
        maxAmountsIn[1] = _wethBalance;

        BALANCER_VAULT.joinPool(
            BAL_ETH_POOL_ID,
            address(this),
            address(this),
            IBalancerVault.JoinPoolRequest(
                assets,
                maxAmountsIn,
                abi.encode(IBalancerVault.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT, maxAmountsIn, _minAmountOut),
                false // Don't use internal balances
            )
        );

        ethContributed = ethContributed + (_wethBalance - WETH.balanceOf(address(this)));
    }

    /**
     * @notice withdraws BAL and WETH from BPT position
     * @param  _minBalOut  slippage check for Bal output
     * @param  _minWethOut slippage check for Weth output
     */
    function _exitBalEthPool(uint256 _minBalOut, uint256 _minWethOut) internal {
        IAsset[] memory assets = new IAsset[](2);
        assets[0] = IAsset(address(BAL));
        assets[1] = IAsset(address(WETH));
        uint256[] memory minAmountsOut = new uint256[](2);
        minAmountsOut[0] = _minBalOut;
        minAmountsOut[1] = _minWethOut;
        uint256 balance = BAL_ETH_BPT.balanceOf(address(this));

        BALANCER_VAULT.exitPool(
            BAL_ETH_POOL_ID,
            address(this),
            payable(address(this)),
            IBalancerVault.ExitPoolRequest(
                assets,
                minAmountsOut,
                abi.encode(IBalancerVault.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT, balance),
                false // Don't use internal balances
            )
        );
    }

    /**
     * @notice helper function for increasing lock amount
     * @param  _amount  BPT quantity to increase lock by
     */
    function _increaseLock(uint256 _amount) internal {
        BAL_ETH_BPT.safeApprove(address(votingEscrow), _amount);
        votingEscrow.increase_amount(_amount);
    }

    /* ----------------------------------------------------------------
       View Functions 
    ---------------------------------------------------------------- */

    /**
     * @notice View function for seeing grant unlock time
     */
    function unlockTime() external view returns (uint256) {
        return votingEscrow.locked__end(address(this));
    }

    /**
     * @notice View function for seeing current veBalance of grant
     */
    function veBalance() external view returns (uint256) {
        return votingEscrow.balanceOf(address(this));
    }
}
