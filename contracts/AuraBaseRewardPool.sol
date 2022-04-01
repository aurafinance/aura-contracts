// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "@openzeppelin/contracts-0.6/token/ERC20/IERC20.sol";
import "convex-platform/contracts/contracts/BaseRewardPool.sol";

/**
 * @dev see https://github.com/fei-protocol/ERC4626/blob/main/src/interfaces/IERC4626.sol#L58
 */
contract AuraBaseRewardPool is BaseRewardPool {
    /**
     * @notice The address of the underlying ERC20 token used for
     * the Vault for accounting, depositing, and withdrawing.
     */
    address public asset;

    /**
     * @dev See BaseRewardPool.sol
     */
    constructor(
        uint256 pid_,
        address stakingToken_,
        address rewardToken_,
        address operator_,
        address rewardManager_,
        address lpToken_
    ) public BaseRewardPool(pid_, stakingToken_, rewardToken_, operator_, rewardManager_) {
        asset = lpToken_;
    }

    event Deposit(address indexed sender, address indexed receiver, uint256 assets, uint256 shares);

    event Withdraw(address indexed sender, address indexed receiver, uint256 assets, uint256 shares);

    /*////////////////////////////////////////////////////////
                      Deposit/Withdrawal Logic
    ////////////////////////////////////////////////////////*/

    /**
     * @notice Mints `shares` Vault shares to `receiver` by
     * depositing exactly `assets` of underlying tokens.
     */
    function deposit(uint256 assets, address receiver) public virtual returns (uint256) {
        IDeposit(operator).deposit(pid, assets, false);
        _processStake(assets);
        emit Deposit(msg.sender, receiver, assets, assets);
        return assets;
    }

    /**
     * @notice Mints exactly `shares` Vault shares to `receiver`
     * by depositing `assets` of underlying tokens.
     */
    function mint(uint256 shares, address receiver) external virtual returns (uint256) {
        return deposit(shares, receiver);
    }

    /**
     * @notice Redeems `shares` from `owner` and sends `assets`
     * of underlying tokens to `receiver`.
     */
    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) public virtual returns (uint256) {
        require(receiver == msg.sender && owner == msg.sender, "!sender");
        withdrawAndUnwrap(assets, true);
        emit Withdraw(msg.sender, receiver, assets, assets);
        return assets;
    }

    /**
     * @notice Redeems `shares` from `owner` and sends `assets`
     * of underlying tokens to `receiver`.
     */
    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) external virtual returns (uint256) {
        return withdraw(shares, receiver, owner);
    }

    /*////////////////////////////////////////////////////////
                      Vault Accounting Logic
    ////////////////////////////////////////////////////////*/

    /**
     * @notice The amount of shares that the vault would
     * exchange for the amount of assets provided, in an
     * ideal scenario where all the conditions are met.
     */
    function convertToShares(uint256 assets) external view virtual returns (uint256) {
        return assets;
    }

    /**
     * @notice The amount of assets that the vault would
     * exchange for the amount of shares provided, in an
     * ideal scenario where all the conditions are met.
     */
    function convertToAssets(uint256 shares) external view virtual returns (uint256) {
        return shares;
    }

    /**
     * @notice Total number of underlying assets that can
     * be deposited by `owner` into the Vault, where `owner`
     * corresponds to the input parameter `receiver` of a
     * `deposit` call.
     */
    function maxDeposit(address owner) public view virtual returns (uint256) {
        return IERC20(asset).balanceOf(owner);
    }

    /**
     * @notice Total number of underlying shares that can be minted
     * for `owner`, where `owner` corresponds to the input
     * parameter `receiver` of a `mint` call.
     */
    function maxMint(address owner) external view virtual returns (uint256) {
        return maxDeposit(owner);
    }

    /**
     * @notice Total number of underlying assets that can be
     * withdrawn from the Vault by `owner`, where `owner`
     * corresponds to the input parameter of a `withdraw` call.
     */
    function maxWithdraw(address owner) public view virtual returns (uint256) {
        return balanceOf(owner);
    }

    /**
     * @notice Total number of underlying shares that can be
     * redeemed from the Vault by `owner`, where `owner` corresponds
     * to the input parameter of a `redeem` call.
     */
    function maxRedeem(address owner) external view virtual returns (uint256) {
        return maxWithdraw(owner);
    }
}
