// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IBalancerPool, IBalancerVault } from "../interfaces/balancer/IBalancerCore.sol";
import { AuraLocker } from "../core/AuraLocker.sol";
import { IBooster } from "../interfaces/IBooster.sol";
import { IAuraBalVault } from "../interfaces/IAuraBalVault.sol";

/**
 * @title   AuraViewHelpers
 * @author  AuraFinance
 * @notice  View-only contract to combine calls
 * @dev     IMPORTANT: These functions are extremely gas-intensive
            and should not be called from within a transaction.
 */
contract AuraViewHelpers {
    IBalancerVault public immutable balancerVault = IBalancerVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);

    struct Token {
        address addr;
        uint8 decimals;
        string symbol;
        string name;
    }

    struct Pool {
        uint256 pid;
        address lptoken;
        address token;
        address gauge;
        address crvRewards;
        address stash;
        bool shutdown;
        address rewardToken;
        bytes32 poolId;
        uint256[] normalizedWeights;
        address[] poolTokens;
        uint256[] underlying;
        uint256 totalSupply;
        RewardsData rewardsData;
        ExtraRewards[] extraRewards;
    }

    struct Vault {
        address addr;
        address underlying;
        uint256 totalUnderlying;
        uint256 totalSupply;
        uint256 withdrawalPenalty;
        ExtraRewards[] extraRewards;
    }

    struct VaultAccount {
        address addr;
        uint256 balance;
        uint256 balanceOfUnderlying;
        uint256[] extraRewardsEarned;
    }

    struct Locker {
        uint256 epoch;
        uint256 totalSupply;
        uint256 lockedSupply;
        RewardsData rewardsData;
    }

    struct LockerAccount {
        address addr;
        uint256 total;
        uint256 unlockable;
        uint256 locked;
        uint256 nextUnlockIndex;
        uint128 rewardPerTokenPaid;
        uint128 rewards;
        address delegate;
        uint256 votes;
        AuraLocker.LockedBalance[] lockData;
        AuraLocker.EarnedData[] claimableRewards;
    }

    struct RewardsData {
        uint256 periodFinish;
        uint256 lastUpdateTime;
        uint256 rewardRate;
        uint256 rewardPerTokenStored;
        uint256 queuedRewards;
    }

    struct ExtraRewards {
        address addr;
        address rewardsToken;
        RewardsData rewardsData;
    }

    struct PoolBalances {
        uint256 pid;
        uint256 earned;
        uint256[] extraRewardsEarned;
        uint256 staked;
    }

    function getVault(address _vault) external view returns (Vault memory vault) {
        IAuraBalVault auraBalVault = IAuraBalVault(_vault);

        address underlying = auraBalVault.underlying();
        uint256 totalUnderlying = auraBalVault.totalUnderlying();
        uint256 totalSupply = auraBalVault.totalSupply();
        uint256 withdrawPenalty = auraBalVault.withdrawalPenalty();

        ExtraRewards[] memory extraRewards = getExtraRewards(_vault);

        vault = Vault({
            addr: _vault,
            underlying: underlying,
            totalUnderlying: totalUnderlying,
            totalSupply: totalSupply,
            withdrawalPenalty: withdrawPenalty,
            extraRewards: extraRewards
        });
    }

    function getVaultAccount(address _vault, address _account)
        external
        view
        returns (VaultAccount memory vaultAccount)
    {
        IAuraBalVault auraBalVault = IAuraBalVault(_vault);

        uint256 balance = auraBalVault.balanceOf(_account);
        uint256 balanceOfUnderlying = auraBalVault.balanceOfUnderlying(_account);

        uint256 extraRewardsLength = auraBalVault.extraRewardsLength();
        uint256[] memory extraRewardsEarned = new uint256[](extraRewardsLength);
        for (uint256 i = 0; i < extraRewardsLength; i++) {
            IBaseRewardPool extraRewardsPool = IBaseRewardPool(auraBalVault.extraRewards(i));
            extraRewardsEarned[i] = extraRewardsPool.earned(_account);
        }

        vaultAccount = VaultAccount({
            addr: _account,
            balance: balance,
            balanceOfUnderlying: balanceOfUnderlying,
            extraRewardsEarned: extraRewardsEarned
        });
    }

    function getLocker(address _locker) external view returns (Locker memory locker) {
        AuraLocker auraLocker = AuraLocker(_locker);
        address rewardToken = auraLocker.cvxCrv();
        (uint32 periodFinish, uint32 lastUpdateTime, uint96 rewardRate, uint96 rewardPerTokenStored) = auraLocker
            .rewardData(rewardToken);

        RewardsData memory rewardsData = RewardsData({
            rewardRate: uint256(rewardRate),
            rewardPerTokenStored: uint256(rewardPerTokenStored),
            periodFinish: uint256(periodFinish),
            lastUpdateTime: uint256(lastUpdateTime),
            queuedRewards: auraLocker.queuedRewards(rewardToken)
        });

        locker = Locker({
            epoch: auraLocker.epochCount(),
            totalSupply: auraLocker.totalSupply(),
            lockedSupply: auraLocker.lockedSupply(),
            rewardsData: rewardsData
        });
    }

    function getLockerAccount(address _locker, address _account)
        external
        view
        returns (LockerAccount memory lockerAccount)
    {
        AuraLocker auraLocker = AuraLocker(_locker);
        address cvxCrv = auraLocker.cvxCrv();
        (, uint112 nextUnlockIndex) = auraLocker.balances(_account);
        (uint128 rewardPerTokenPaid, uint128 rewards) = auraLocker.userData(cvxCrv, _account);
        (uint256 total, uint256 unlockable, uint256 locked, AuraLocker.LockedBalance[] memory lockData) = auraLocker
            .lockedBalances(_account);

        lockerAccount = LockerAccount({
            addr: _account,
            total: total,
            unlockable: unlockable,
            locked: locked,
            lockData: lockData,
            nextUnlockIndex: uint256(nextUnlockIndex),
            rewardPerTokenPaid: rewardPerTokenPaid,
            rewards: rewards,
            delegate: auraLocker.delegates(_account),
            votes: auraLocker.balanceOf(_account),
            claimableRewards: auraLocker.claimableRewards(_account)
        });
    }

    function getPools(address _booster) external view returns (Pool[] memory) {
        IBooster booster = IBooster(_booster);

        uint256 poolLength = booster.poolLength();
        Pool[] memory pools = new Pool[](poolLength + 1); // +1 for cvxCrvRewards

        for (uint256 i = 0; i < poolLength; i++) {
            IBooster.PoolInfo memory poolInfo = booster.poolInfo(i);
            pools[i] = getPool(poolInfo, i);
        }

        // Add cvxCrvRewards
        pools[poolLength] = getCvxCrvRewards(booster.lockRewards());

        return pools;
    }

    function getCvxCrvRewards(address _cvxCrvRewards) public view returns (Pool memory) {
        IBaseRewardPool pool = IBaseRewardPool(_cvxCrvRewards);
        address cvxCrv = pool.stakingToken();

        uint256[] memory normalizedWeights = new uint256[](1);
        normalizedWeights[0] = 1;
        address[] memory poolTokens = new address[](1);
        poolTokens[0] = cvxCrv;
        uint256[] memory underlying = new uint256[](1);
        underlying[0] = IERC20Detailed(cvxCrv).balanceOf(_cvxCrvRewards);

        RewardsData memory rewardsData = RewardsData({
            rewardRate: pool.rewardRate(),
            periodFinish: pool.periodFinish(),
            lastUpdateTime: pool.lastUpdateTime(),
            rewardPerTokenStored: pool.rewardPerTokenStored(),
            queuedRewards: pool.queuedRewards()
        });

        ExtraRewards[] memory extraRewards = getExtraRewards(_cvxCrvRewards);

        return
            Pool({
                pid: uint256(0),
                lptoken: cvxCrv,
                token: cvxCrv,
                gauge: address(0),
                crvRewards: _cvxCrvRewards,
                stash: address(0),
                shutdown: false,
                rewardToken: pool.rewardToken(),
                poolId: bytes32(0),
                normalizedWeights: normalizedWeights,
                poolTokens: poolTokens,
                underlying: underlying,
                rewardsData: rewardsData,
                extraRewards: extraRewards,
                totalSupply: pool.totalSupply()
            });
    }

    function getExtraRewards(address _baseRewardPool) internal view returns (ExtraRewards[] memory) {
        IBaseRewardPool baseRewardPool = IBaseRewardPool(_baseRewardPool);

        uint256 extraRewardsLength = baseRewardPool.extraRewardsLength();
        ExtraRewards[] memory extraRewards = new ExtraRewards[](extraRewardsLength);

        for (uint256 i = 0; i < extraRewardsLength; i++) {
            address addr = baseRewardPool.extraRewards(i);
            IBaseRewardPool extraRewardsPool = IBaseRewardPool(addr);
            RewardsData memory data = RewardsData({
                rewardRate: extraRewardsPool.rewardRate(),
                periodFinish: extraRewardsPool.periodFinish(),
                lastUpdateTime: extraRewardsPool.lastUpdateTime(),
                rewardPerTokenStored: extraRewardsPool.rewardPerTokenStored(),
                queuedRewards: extraRewardsPool.queuedRewards()
            });
            extraRewards[i] = ExtraRewards({
                addr: addr,
                rewardsData: data,
                rewardsToken: extraRewardsPool.rewardToken()
            });
        }

        return extraRewards;
    }

    function getPool(IBooster.PoolInfo memory poolInfo, uint256 _pid) public view returns (Pool memory) {
        IBaseRewardPool rewardPool = IBaseRewardPool(poolInfo.crvRewards);
        IBalancerPool balancerPool = IBalancerPool(poolInfo.lptoken);

        // Some pools were added to the Booster without valid LP tokens;
        // we need to try/catch all of these calls as a result.
        bytes32 poolId;
        uint256[] memory normalizedWeights;
        address[] memory poolTokens;
        uint256[] memory underlying;

        try balancerPool.getPoolId() returns (bytes32 fetchedPoolId) {
            poolId = fetchedPoolId;
            (poolTokens, underlying, ) = balancerVault.getPoolTokens(poolId);

            try balancerPool.getNormalizedWeights() returns (uint256[] memory weights) {
                normalizedWeights = weights;
            } catch {
                normalizedWeights = new uint256[](0);
            }
        } catch {
            poolId = bytes32(0);
            poolTokens = new address[](0);
            underlying = new uint256[](0);
            normalizedWeights = new uint256[](0);
        }

        ExtraRewards[] memory extraRewards = getExtraRewards(poolInfo.crvRewards);

        RewardsData memory rewardsData = RewardsData({
            rewardRate: rewardPool.rewardRate(),
            periodFinish: rewardPool.periodFinish(),
            lastUpdateTime: rewardPool.lastUpdateTime(),
            rewardPerTokenStored: rewardPool.rewardPerTokenStored(),
            queuedRewards: rewardPool.queuedRewards()
        });

        return
            Pool({
                pid: _pid,
                lptoken: poolInfo.lptoken,
                token: poolInfo.token,
                gauge: poolInfo.gauge,
                crvRewards: poolInfo.crvRewards,
                stash: poolInfo.stash,
                shutdown: poolInfo.shutdown,
                rewardToken: rewardPool.rewardToken(),
                poolId: poolId,
                normalizedWeights: normalizedWeights,
                poolTokens: poolTokens,
                underlying: underlying,
                rewardsData: rewardsData,
                extraRewards: extraRewards,
                totalSupply: rewardPool.totalSupply()
            });
    }

    function getPoolsBalances(address _booster, address _account) external view returns (PoolBalances[] memory) {
        uint256 poolLength = IBooster(_booster).poolLength();
        PoolBalances[] memory balances = new PoolBalances[](poolLength);
        for (uint256 i = 0; i < poolLength; i++) {
            IBooster.PoolInfo memory poolInfo = IBooster(_booster).poolInfo(i);
            balances[i] = getPoolBalances(poolInfo.crvRewards, i, _account);
        }
        return balances;
    }

    function getPoolBalances(
        address _rewardPool,
        uint256 _pid,
        address _account
    ) public view returns (PoolBalances memory) {
        IBaseRewardPool pool = IBaseRewardPool(_rewardPool);
        uint256 staked = pool.balanceOf(_account);
        uint256 earned = pool.earned(_account);

        uint256 extraRewardsLength = pool.extraRewardsLength();
        uint256[] memory extraRewardsEarned = new uint256[](extraRewardsLength);
        for (uint256 i = 0; i < extraRewardsLength; i++) {
            IBaseRewardPool extraRewardsPool = IBaseRewardPool(pool.extraRewards(i));
            extraRewardsEarned[i] = extraRewardsPool.earned(_account);
        }

        return PoolBalances({ pid: _pid, staked: staked, earned: earned, extraRewardsEarned: extraRewardsEarned });
    }

    function getTokens(address[] memory _addresses) public view returns (Token[] memory) {
        uint256 length = _addresses.length;
        Token[] memory tokens = new Token[](length);

        for (uint256 i = 0; i < length; i++) {
            address addr = _addresses[i];
            IERC20Detailed token = IERC20Detailed(addr);

            uint8 decimals;
            try token.decimals() {
                decimals = token.decimals();
            } catch {
                decimals = 0;
            }

            tokens[i] = Token({ addr: addr, decimals: decimals, symbol: token.symbol(), name: token.name() });
        }

        return tokens;
    }

    function getEarmarkingReward(
        uint256 pool,
        address booster,
        address token
    ) public returns (uint256 pending) {
        uint256 start = IERC20Detailed(token).balanceOf(address(this));
        IBooster(booster).earmarkRewards(pool);
        pending = IERC20Detailed(token).balanceOf(address(this)) - start;
    }

    function getMultipleEarmarkingRewards(
        uint256[] memory pools,
        address booster,
        address token
    ) external returns (uint256[] memory pendings) {
        pendings = new uint256[](pools.length);
        for (uint256 i = 0; i < pools.length; i++) {
            pendings[i] = getEarmarkingReward(pools[i], booster, token);
        }
    }
}

interface IBaseRewardPool {
    function extraRewards(uint256 index) external view returns (address rewards);

    function extraRewardsLength() external view returns (uint256);

    function lastUpdateTime() external view returns (uint256);

    function periodFinish() external view returns (uint256);

    function pid() external view returns (uint256);

    function balanceOf(address owner) external view returns (uint256);

    function earned(address owner) external view returns (uint256);

    function queuedRewards() external view returns (uint256);

    function rewardPerTokenStored() external view returns (uint256);

    function rewardRate() external view returns (uint256);

    function totalSupply() external view returns (uint256);

    function rewardToken() external view returns (address);

    function stakingToken() external view returns (address);
}

interface IERC20Detailed {
    function name() external view returns (string memory);

    function symbol() external view returns (string memory);

    function decimals() external view returns (uint8);

    function totalSupply() external view returns (uint256);

    function balanceOf(address owner) external view returns (uint256);
}
