// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IVault, ICrvDepositor, ICrvDepositorWrapper, IBooster } from "./Interfaces.sol";
import { BalInvestor } from "./BalInvestor.sol";
import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";

/**
 * @title   CrvDepositorWrapperWithFee
 * @notice  Applies a fee when passing to CrvDepositorWrapper
 */
contract CrvDepositorWrapperWithFee is ICrvDepositorWrapper, BalInvestor, Ownable {
    using SafeERC20 for IERC20;

    ICrvDepositor public immutable crvDepositor;
    IBooster public immutable booster;
    address public immutable voterProxy;

    uint256 public feeRatio;

    constructor(
        address _crvDepositor,
        IVault _balancerVault,
        address _bal,
        address _weth,
        bytes32 _balETHPoolId,
        IBooster _booster,
        address _voterProxy,
        address _owner
    ) BalInvestor(_balancerVault, _bal, _weth, _balETHPoolId) Ownable() {
        crvDepositor = ICrvDepositor(_crvDepositor);

        booster = _booster;
        voterProxy = _voterProxy;

        _transferOwnership(_owner);
    }

    function setApprovals() external {
        _setApprovals();
        IERC20(BALANCER_POOL_TOKEN).safeApprove(address(crvDepositor), type(uint256).max);
    }

    /**
     * @dev Sets the fee Ratio, where 100% fee == 10000
     */
    function setFeeRatio(uint256 _ratio) external onlyOwner {
        require(_ratio < 10000, "Invalid ratio");
        feeRatio = _ratio;
    }

    /**
     * @dev Get's the min out, for a given _amount, disregarding fees
     */
    function getMinOut(uint256 _amount, uint256 _outputBps) external view returns (uint256) {
        return _getMinOut(_amount, _outputBps);
    }

    /**
     * @dev Deposits via the CrvDepositorWrapper, scaling down the amount and minOut
     *      according to the fees
     */
    function deposit(
        uint256 _amount,
        uint256 _minOut,
        bool _lock,
        address _stakeAddress
    ) external {
        (uint256 amountIn, uint256 fee) = _applyFee(_amount);
        (uint256 minOut, ) = _applyFee(_minOut);

        _investBalToPool(amountIn, minOut);
        uint256 bptBalance = IERC20(BALANCER_POOL_TOKEN).balanceOf(address(this));
        crvDepositor.depositFor(msg.sender, bptBalance, _lock, _stakeAddress);

        if (fee > 0) {
            IERC20(BAL).safeTransferFrom(msg.sender, voterProxy, fee);
            booster.earmarkFees(BAL);
        }
    }

    function _applyFee(uint256 _input) internal view returns (uint256 newInput, uint256 feeAmount) {
        feeAmount = (_input * feeRatio) / 10000;
        newInput = _input - feeAmount;
    }
}
