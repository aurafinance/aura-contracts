// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { IVault, ICrvDepositorWrapper } from "./Interfaces.sol";
import { BalInvestor } from "./BalInvestor.sol";

interface ICrvDepositor {
    function depositFor(
        address to,
        uint256 _amount,
        bool _lock,
        address _stakeAddress
    ) external;
}

/**
 * @title   CrvDepositorWrapper
 * @notice  Converts BAL -> balBPT and then wraps to auraBAL via the crvDepositor
 */
contract CrvDepositorWrapper is ICrvDepositorWrapper, BalInvestor {
    address public immutable crvDeposit;

    constructor(
        address _crvDeposit,
        IVault _balancerVault,
        address _bal,
        address _weth,
        bytes32 _balETHPoolId
    ) BalInvestor(_balancerVault, _bal, _weth, _balETHPoolId) {
        crvDeposit = _crvDeposit;
    }

    function setApprovals() external {
        _setApprovals();
        require(IERC20(BALANCER_POOL_TOKEN).approve(crvDeposit, type(uint256).max), "!approval");
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

    function deposit(
        uint256 _amount,
        uint256 _minOut,
        bool _lock,
        address _stakeAddress
    ) external {
        _investBalToPool(_amount, _minOut);
        uint256 bptBalance = IERC20(BALANCER_POOL_TOKEN).balanceOf(address(this));
        ICrvDepositor(crvDeposit).depositFor(msg.sender, bptBalance, _lock, _stakeAddress);
    }
}
