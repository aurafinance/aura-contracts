// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { IGenericVault } from "../interfaces/IGenericVault.sol";
import { IRewardHandler } from "../interfaces/balancer/IRewardHandler.sol";
import { IVirtualRewards } from "../interfaces/IVirtualRewards.sol";
import { AuraBalStrategyBase } from "./StrategyBase.sol";

/**
 * @title   AuraBalStrategy
 * @author  llama.airforce -> AuraFinance
 * @notice  Changes:
 *          - remove option to lock auraBAL instead of swapping it
 *          - remove paltform fee
 */
contract AuraBalStrategy is Ownable, AuraBalStrategyBase {
    using SafeERC20 for IERC20;

    address public immutable vault;
    address[] public rewardTokens;
    mapping(address => address) public rewardHandlers;

    uint256 public constant FEE_DENOMINATOR = 10000;

    constructor(
        address _vault,
        // AuraBalStrategyBase
        address _balVault,
        address _auraBalStaking,
        address _balToken,
        address _wethToken,
        address _auraToken,
        address _auraBalToken,
        address _bbusdToken,
        bytes32 _auraBalBalETHBptPoolId,
        bytes32 _balETHPoolId
    )
        AuraBalStrategyBase(
            _balVault,
            _auraBalStaking,
            _balToken,
            _wethToken,
            _auraToken,
            _auraBalToken,
            _bbusdToken,
            _auraBalBalETHBptPoolId,
            _balETHPoolId
        )
    {
        vault = _vault;
    }

    /// @notice Set approvals for the contracts used when swapping & staking
    function setApprovals() external {
        IERC20(AURABAL_TOKEN).safeApprove(address(auraBalStaking), 0);
        IERC20(AURABAL_TOKEN).safeApprove(address(auraBalStaking), type(uint256).max);
        IERC20(BAL_TOKEN).safeApprove(address(balVault), 0);
        IERC20(BAL_TOKEN).safeApprove(address(balVault), type(uint256).max);
        IERC20(WETH_TOKEN).safeApprove(address(balVault), 0);
        IERC20(WETH_TOKEN).safeApprove(address(balVault), type(uint256).max);
        IERC20(BAL_ETH_POOL_TOKEN).safeApprove(address(balVault), 0);
        IERC20(BAL_ETH_POOL_TOKEN).safeApprove(address(balVault), type(uint256).max);
    }

    /// @notice update the token to handler mapping
    function _updateRewardToken(address _token, address _handler) internal {
        rewardHandlers[_token] = _handler;
    }

    /// @notice Add a reward token and its handler
    /// @dev For tokens that should not be swapped (i.e. BAL rewards)
    ///      use address as zero handler
    /// @param _token the reward token to add
    /// @param _handler address of the contract that will sell for BAL or ETH
    function addRewardToken(address _token, address _handler) external onlyOwner {
        rewardTokens.push(_token);
        _updateRewardToken(_token, _handler);
    }

    /// @notice Update the handler of a reward token
    /// @dev Used to update a handler or retire a token (set handler to address 0)
    /// @param _token the reward token to add
    /// @param _handler address of the contract that will sell for BAL or ETH
    function updateRewardToken(address _token, address _handler) external onlyOwner {
        _updateRewardToken(_token, _handler);
    }

    /// @notice returns the number of reward tokens
    /// @return the number of reward tokens
    function totalRewardTokens() external view returns (uint256) {
        return rewardTokens.length;
    }

    /// @notice Query the amount currently staked
    /// @return total - the total amount of tokens staked
    function totalUnderlying() public view returns (uint256 total) {
        return auraBalStaking.balanceOf(address(this));
    }

    /// @notice Deposits underlying tokens in the staking contract
    function stake(uint256 _amount) public onlyVault {
        auraBalStaking.stake(_amount);
    }

    /// @notice Withdraw a certain amount from the staking contract
    /// @param _amount - the amount to withdraw
    /// @dev Can only be called by the vault
    function withdraw(uint256 _amount) external onlyVault {
        auraBalStaking.withdraw(_amount, false);
        IERC20(AURABAL_TOKEN).safeTransfer(vault, _amount);
    }

    /// @notice Claim rewards and swaps them to FXS for restaking
    /// @dev Can be called by the vault only
    /// @param _minAmountOut -  min amount of LP tokens to receive w/o revert
    /// @return harvested - the amount harvested
    function harvest(uint256 _minAmountOut) public onlyVault returns (uint256 harvested) {
        // claim rewards
        auraBalStaking.getReward();

        // process extra rewards
        uint256 extraRewardCount = IGenericVault(vault).extraRewardsLength();
        for (uint256 i; i < extraRewardCount; ++i) {
            address rewards = IGenericVault(vault).extraRewards(i);
            address token = IVirtualRewards(rewards).rewardToken();
            uint256 balance = IERC20(token).balanceOf(address(this));
            if (balance > 0) {
                IERC20(token).safeTransfer(rewards, balance);
                IVirtualRewards(rewards).queueNewRewards(balance);
            }
        }

        // process rewards
        address[] memory _rewardTokens = rewardTokens;
        for (uint256 i; i < _rewardTokens.length; ++i) {
            address _tokenHandler = rewardHandlers[_rewardTokens[i]];
            if (_tokenHandler == address(0)) {
                continue;
            }
            uint256 _tokenBalance = IERC20(_rewardTokens[i]).balanceOf(address(this));
            if (_tokenBalance > 0) {
                IERC20(_rewardTokens[i]).safeTransfer(_tokenHandler, _tokenBalance);
                IRewardHandler(_tokenHandler).sell();
            }
        }

        uint256 _wethBalance = IERC20(WETH_TOKEN).balanceOf(address(this));
        uint256 _balBalance = IERC20(BAL_TOKEN).balanceOf(address(this));

        if (_wethBalance + _balBalance == 0) {
            return 0;
        }
        // Deposit to BLP
        _depositToBalEthPool(_balBalance, _wethBalance, 0);

        // Swap the LP tokens for aura BAL
        uint256 _bptBalance = IERC20(BAL_ETH_POOL_TOKEN).balanceOf(address(this));
        uint256 _auraBalBalance = _swapBptToAuraBal(_bptBalance, _minAmountOut);

        if (_auraBalBalance > 0) {
            stake(_auraBalBalance);
            return _auraBalBalance;
        }

        return 0;
    }

    modifier onlyVault() {
        require(vault == msg.sender, "Vault calls only");
        _;
    }
}
