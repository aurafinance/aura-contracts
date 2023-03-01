// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { ERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { IERC4626 } from "../interfaces/IERC4626.sol";
import { IStrategy } from "../interfaces/IStrategy.sol";
import { IBasicRewards } from "../interfaces/IBasicRewards.sol";

/**
 * @title   GenericUnionVault
 * @author  llama.airforce -> AuraFinance
 * @notice  Changes:
 *          - remove withdraw penalty
 *          - remove platform fee
 *          - add extra rewards logic
 */
contract GenericUnionVault is ERC20, IERC4626, Ownable {
    using SafeERC20 for IERC20;

    uint256 public withdrawalPenalty = 100;
    uint256 public constant MAX_WITHDRAWAL_PENALTY = 150;
    uint256 public constant FEE_DENOMINATOR = 10000;

    address public immutable underlying;
    address public strategy;

    address[] public extraRewards;

    event WithdrawalPenaltyUpdated(uint256 _penalty);
    event Harvest(address indexed _caller, uint256 _value);
    event CallerIncentiveUpdated(uint256 _incentive);
    event StrategySet(address indexed _strategy);
    event ExtraRewardAdded(address indexed _reward);
    event ExtraRewardCleared(address indexed _reward);

    constructor(address _token)
        ERC20(
            string(abi.encodePacked("Staked ", ERC20(_token).name())),
            string(abi.encodePacked("stk", ERC20(_token).symbol()))
        )
    {
        underlying = _token;
    }

    /// @notice Updates the withdrawal penalty
    /// @param _penalty - the amount of the new penalty (in BIPS)
    function setWithdrawalPenalty(uint256 _penalty) external onlyOwner {
        require(_penalty <= MAX_WITHDRAWAL_PENALTY);
        withdrawalPenalty = _penalty;
        emit WithdrawalPenaltyUpdated(_penalty);
    }

    /// @notice Set the address of the strategy contract
    /// @dev Can only be set once
    /// @param _strategy - address of the strategy contract
    function setStrategy(address _strategy) external onlyOwner notToZeroAddress(_strategy) {
        require(strategy == address(0), "Strategy already set");
        strategy = _strategy;
        emit StrategySet(_strategy);
    }

    /// @notice Count of extra rewards
    function extraRewardsLength() external view returns (uint256) {
        return extraRewards.length;
    }

    /// @notice Add extra reward contract
    /// @param _reward VirtualShareRewardPool address
    /// @return bool success
    function addExtraReward(address _reward) external onlyOwner notToZeroAddress(_reward) returns (bool) {
        if (extraRewards.length >= 12) {
            return false;
        }

        extraRewards.push(_reward);
        emit ExtraRewardAdded(_reward);
        return true;
    }

    /// @notice Clear extra rewards array
    function clearExtraRewards() external onlyOwner {
        uint256 len = extraRewards.length;
        for (uint256 i = 0; i < len; i++) {
            emit ExtraRewardCleared(extraRewards[i]);
        }
        delete extraRewards;
    }

    /// @notice Query the amount currently staked
    /// @return total - the total amount of tokens staked
    function totalUnderlying() public view returns (uint256 total) {
        return IStrategy(strategy).totalUnderlying();
    }

    /// @notice Returns the amount of underlying a user can claim
    /// @param user - address whose claimable amount to query
    /// @return amount - claimable amount
    /// @dev Does not account for penalties and fees
    function balanceOfUnderlying(address user) external view returns (uint256 amount) {
        require(totalSupply() > 0, "No users");
        return ((balanceOf(user) * totalUnderlying()) / totalSupply());
    }

    /// @notice Deposit user funds in the autocompounder and mints tokens
    /// representing user's share of the pool in exchange
    /// @param _amount - the amount of underlying to deposit
    /// @return _shares - the amount of shares issued
    function deposit(uint256 _amount, address _receiver) public notToZeroAddress(_receiver) returns (uint256 _shares) {
        require(_amount > 0, "Deposit too small");

        // Stake into extra rewards before we update the users
        // balancers and update totalSupply/totalUnderlying
        for (uint256 i = 0; i < extraRewards.length; i++) {
            IBasicRewards(extraRewards[i]).stake(_receiver, _amount);
        }

        uint256 _before = totalUnderlying();
        IERC20(underlying).safeTransferFrom(msg.sender, strategy, _amount);
        IStrategy(strategy).stake(_amount);

        // Issues shares in proportion of deposit to pool amount
        uint256 shares = 0;
        if (totalSupply() == 0) {
            shares = _amount;
        } else {
            shares = (_amount * totalSupply()) / _before;
        }

        _mint(_receiver, shares);
        emit Deposit(msg.sender, _receiver, _amount, shares);
        return shares;
    }

    /// @notice Unstake underlying in proportion to the amount of shares sent
    /// @param _shares - the number of shares sent
    /// @return _withdrawable - the withdrawable underlying amount
    function _withdraw(address _from, uint256 _shares) internal returns (uint256 _withdrawable) {
        require(totalSupply() > 0);
        // Computes the amount withdrawable based on the number of shares sent
        uint256 amount = (_shares * totalUnderlying()) / totalSupply();
        // Burn the shares before retrieving tokens
        _burn(_from, _shares);
        // If user is last to withdraw, harvest before exit
        if (totalSupply() == 0) {
            harvest();
            IStrategy(strategy).withdraw(totalUnderlying());
            _withdrawable = IERC20(underlying).balanceOf(address(this));
        }
        // Otherwise compute share and unstake
        else {
            _withdrawable = amount;
            // Substract a small withdrawal fee to prevent users "timing"
            // the harvests. The fee stays staked and is therefore
            // redistributed to all remaining participants.
            uint256 _penalty = (_withdrawable * withdrawalPenalty) / FEE_DENOMINATOR;
            _withdrawable = _withdrawable - _penalty;
            IStrategy(strategy).withdraw(_withdrawable);
        }
        return _withdrawable;
    }

    /// @notice Unstake underlying token in proportion to the amount of shares sent
    /// @param _shares - the number of shares sent
    /// @return withdrawn - the amount of underlying returned to the user
    function redeem(
        uint256 _shares,
        address _receiver,
        address _owner
    ) public notToZeroAddress(_receiver) notToZeroAddress(_owner) returns (uint256 withdrawn) {
        // Check allowance if owner if not sender
        if (msg.sender != _owner) {
            uint256 currentAllowance = allowance(_owner, msg.sender);
            require(currentAllowance >= _shares, "ERC4626: redeem exceeds allowance");
            _approve(_owner, msg.sender, currentAllowance - _shares);
        }

        // Withdraw from extra rewards
        for (uint256 i = 0; i < extraRewards.length; i++) {
            IBasicRewards(extraRewards[i]).withdraw(_owner, _shares);
        }

        // Withdraw requested amount of underlying
        uint256 _withdrawable = _withdraw(_owner, _shares);
        // And sends back underlying to user
        IERC20(underlying).safeTransfer(_receiver, _withdrawable);
        emit Withdraw(msg.sender, _receiver, _owner, _withdrawable, _shares);
        return _withdrawable;
    }

    /// @notice Claim rewards and swaps them to FXS for restaking
    /// @dev Can be called by anyone against an incentive in FXS
    /// @dev Harvest logic in the strategy contract
    function harvest() public virtual {
        uint256 _harvested = IStrategy(strategy).harvest();
        emit Harvest(msg.sender, _harvested);
    }

    modifier notToZeroAddress(address _to) {
        require(_to != address(0), "Invalid address!");
        _;
    }

    /* --------------------------------------------------------------
     * EIP-4626 functions
    ----------------------------------------------------------------- */

    /// @notice The address of the underlying token used for the Vault for
    /// accounting, depositing, and withdrawing.
    function asset() public view returns (address) {
        return underlying;
    }

    /// @notice Total amount of the underlying asset that is “managed” by Vault.
    function totalAssets() public view returns (uint256) {
        return totalUnderlying();
    }

    /// @notice The amount of shares that the Vault would exchange for the amount
    /// of assets provided, in an ideal scenario where all the conditions are met.
    function convertToShares(uint256 _assets) public view returns (uint256) {
        return totalSupply() == 0 ? _assets : (_assets * totalSupply()) / totalAssets();
    }

    /// @notice The amount of assets that the Vault would exchange for the amount
    /// of shares provided, in an ideal scenario where all the conditions are met.
    function convertToAssets(uint256 _shares) public view returns (uint256) {
        return totalSupply() == 0 ? _shares : (_shares * totalUnderlying()) / totalSupply();
    }

    /// @notice Maximum amount of the underlying asset that can be deposited into
    /// the Vault for the receiver, through a deposit call.
    function maxDeposit(address) public pure returns (uint256) {
        return type(uint256).max;
    }

    /// @notice Allows an on-chain or off-chain user to simulate the effects of
    /// their deposit at the current block, given current on-chain conditions.
    function previewDeposit(uint256 _assets) public view returns (uint256) {
        return convertToShares(_assets);
    }

    /// @notice Maximum amount of shares that can be minted from the Vault
    /// for the receiver, through a mint call.
    function maxMint(address) public pure returns (uint256) {
        return type(uint256).max;
    }

    /// @notice Allows an on-chain or off-chain user to simulate the effects of
    /// their mint at the current block, given current on-chain conditions.
    function previewMint(uint256 _shares) public view returns (uint256) {
        return convertToAssets(_shares);
    }

    /// @notice Mints exactly shares Vault shares to receiver by depositing
    /// assets of underlying tokens.
    function mint(uint256 _shares, address _receiver) public returns (uint256) {
        uint256 assets = convertToAssets(_shares);
        return deposit(assets, _receiver);
    }

    /// @notice Maximum amount of the underlying asset that can be withdrawn
    /// from the owner balance in the Vault, through a withdraw call.
    function maxWithdraw(address _owner) public view returns (uint256) {
        return convertToAssets(balanceOf(_owner));
    }

    /// @notice Allows an on-chain or off-chain user to simulate the effects
    /// of their withdrawal at the current block, given current on-chain conditions.
    function previewWithdraw(uint256 _assets) public view returns (uint256) {
        return convertToShares(_assets);
    }

    /// @notice Burns shares from owner and sends exactly assets of
    /// underlying tokens to receiver.
    function withdraw(
        uint256 _assets,
        address _receiver,
        address _owner
    ) public returns (uint256) {
        uint256 shares = convertToShares(_assets);
        return redeem(shares, _receiver, _owner);
    }

    /// @notice Maximum amount of Vault shares that can be redeemed from the
    /// owner balance in the Vault, through a redeem call.
    function maxRedeem(address _owner) public view returns (uint256) {
        return balanceOf(_owner);
    }

    /// @notice Allows an on-chain or off-chain user to simulate the effects of
    /// their redeemption at the current block, given current on-chain conditions.
    function previewRedeem(uint256 _shares) public view returns (uint256) {
        return convertToAssets(_shares);
    }
}
