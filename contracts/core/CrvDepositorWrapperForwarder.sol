// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IBalancerVault } from "../interfaces/balancer/IBalancerCore.sol";
import { ICrvDepositorWrapper } from "../interfaces/ICrvDepositorWrapper.sol";
import { ICrvDepositor } from "../interfaces/ICrvDepositor.sol";
import { BalInvestor } from "./BalInvestor.sol";
import { IStashRewardDistro } from "../interfaces/IStashRewardDistro.sol";

/**
 * @title   CrvDepositorWrapperForwarder
 * @notice  Converts BAL -> balBPT, then wraps to auraBAL via the crvDepositor.
 *          Finally it forwards the minted auraBAL to a given address.
 */
contract CrvDepositorWrapperForwarder is ICrvDepositorWrapper, BalInvestor {
    using SafeERC20 for IERC20;

    /// @dev CrvDepositor
    address public immutable crvDeposit;

    /// @dev cvxCrv token
    address public immutable cvxCrv;

    /// @dev Extra reward distro contract
    address public immutable stashRewardDistro;

    /// @dev Poold id where the cvxCrv is forwarder.
    uint256 public immutable pid;

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */
    constructor(
        address _crvDeposit,
        IBalancerVault _balancerVault,
        address _bal,
        address _weth,
        bytes32 _balETHPoolId,
        address _cvxCrv,
        address _stashRewardDistro,
        uint256 _pid
    ) BalInvestor(_balancerVault, _bal, _weth, _balETHPoolId) {
        crvDeposit = _crvDeposit;
        stashRewardDistro = _stashRewardDistro;
        cvxCrv = _cvxCrv;
        pid = _pid;
    }

    function setApprovals() external {
        _setApprovals();
        IERC20(BALANCER_POOL_TOKEN).safeApprove(crvDeposit, type(uint256).max);
        IERC20(cvxCrv).safeApprove(stashRewardDistro, type(uint256).max);
    }

    /**
     * @dev Gets minimum output based on BPT oracle price
     * @param _amount Units of BAL to deposit
     * @param _outputBps Multiplier where 100% == 10000, 99.5% == 9950 and 98% == 9800
     * @return minOut Units of BPT to expect as output
     */
    function getMinOut(uint256 _amount, uint256 _outputBps) external view returns (uint256) {
        return _getMinOut(_amount, _outputBps);
    }

    /**
     * @dev Mints auraBal and transfers it to `forwardTo` address
     * @param _amount Units of BAL to deposit
     * @param _minOut Min amount of auraBal to be deposited.
     * @param _lock Should be always true
     * @param _stakeAddress Hast to be zero address, to ensure cvxCrv is minted only.
     */
    function deposit(
        uint256 _amount,
        uint256 _minOut,
        bool _lock,
        address _stakeAddress
    ) external {
        require(_stakeAddress == address(0), "!_stakeAddress");

        _investBalToPool(_amount, _minOut);
        uint256 bptBalance = IERC20(BALANCER_POOL_TOKEN).balanceOf(address(this));
        ICrvDepositor(crvDeposit).depositFor(address(this), bptBalance, _lock, _stakeAddress);

        // Transfer cvxCrv to a given address, ie to a stash
        uint256 cvxCrvBal = IERC20(cvxCrv).balanceOf(address(this));
        if (cvxCrvBal > 0) {
            IStashRewardDistro(stashRewardDistro).fundPool(pid, cvxCrv, cvxCrvBal, 1);
        }
    }
}
