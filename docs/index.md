# Solidity API

## IStaker

### operator

```solidity
function operator() external view returns (address)
```

## AuraToken

Basically an ERC20 with minting functionality operated by the "operator" of the VoterProxy (Booster).

_The minting schedule is based on the amount of CRV earned through staking and is
distributed along a supply curve (cliffs etc). Fork of ConvexToken._

### operator

```solidity
address operator
```

### vecrvProxy

```solidity
address vecrvProxy
```

### EMISSIONS_MAX_SUPPLY

```solidity
uint256 EMISSIONS_MAX_SUPPLY
```

### INIT_MINT_AMOUNT

```solidity
uint256 INIT_MINT_AMOUNT
```

### totalCliffs

```solidity
uint256 totalCliffs
```

### reductionPerCliff

```solidity
uint256 reductionPerCliff
```

### minter

```solidity
address minter
```

### minterMinted

```solidity
uint256 minterMinted
```

### Initialised

```solidity
event Initialised()
```

### OperatorChanged

```solidity
event OperatorChanged(address previousOperator, address newOperator)
```

### constructor

```solidity
constructor(address _proxy, string _nameArg, string _symbolArg) public
```

| Name        | Type    | Description    |
| ----------- | ------- | -------------- |
| \_proxy     | address | CVX VoterProxy |
| \_nameArg   | string  | Token name     |
| \_symbolArg | string  | Token symbol   |

### init

```solidity
function init(address _to, address _minter) external
```

_Initialise and mints initial supply of tokens._

| Name     | Type    | Description             |
| -------- | ------- | ----------------------- |
| \_to     | address | Target address to mint. |
| \_minter | address | The minter address.     |

### updateOperator

```solidity
function updateOperator() public
```

_This can be called if the operator of the voterProxy somehow changes._

### mint

```solidity
function mint(address _to, uint256 _amount) external
```

_Mints AURA to a given user based on the BAL supply schedule._

### minterMint

```solidity
function minterMint(address _to, uint256 _amount) external
```

_Allows minter to mint to a specific address_

## AuraBalRewardPool

_Modifications from convex-platform/contracts/contracts/BaseRewardPool.sol: - Delayed start (tokens transferred then delay is enforced before notification) - One time duration of 14 days - Remove child reward contracts - Penalty on claim at 20%_

### rewardToken

```solidity
contract IERC20 rewardToken
```

### stakingToken

```solidity
contract IERC20 stakingToken
```

### duration

```solidity
uint256 duration
```

### rewardManager

```solidity
address rewardManager
```

### auraLocker

```solidity
contract IAuraLocker auraLocker
```

### penaltyForwarder

```solidity
address penaltyForwarder
```

### pendingPenalty

```solidity
uint256 pendingPenalty
```

### startTime

```solidity
uint256 startTime
```

### periodFinish

```solidity
uint256 periodFinish
```

### rewardRate

```solidity
uint256 rewardRate
```

### lastUpdateTime

```solidity
uint256 lastUpdateTime
```

### rewardPerTokenStored

```solidity
uint256 rewardPerTokenStored
```

### \_totalSupply

```solidity
uint256 _totalSupply
```

### userRewardPerTokenPaid

```solidity
mapping(address => uint256) userRewardPerTokenPaid
```

### rewards

```solidity
mapping(address => uint256) rewards
```

### \_balances

```solidity
mapping(address => uint256) _balances
```

### RewardAdded

```solidity
event RewardAdded(uint256 reward)
```

### Staked

```solidity
event Staked(address user, uint256 amount)
```

### Withdrawn

```solidity
event Withdrawn(address user, uint256 amount)
```

### RewardPaid

```solidity
event RewardPaid(address user, uint256 reward, bool locked)
```

### PenaltyForwarded

```solidity
event PenaltyForwarded(uint256 amount)
```

### Rescued

```solidity
event Rescued()
```

### constructor

```solidity
constructor(address _stakingToken, address _rewardToken, address _rewardManager, address _auraLocker, address _penaltyForwarder, uint256 _startDelay) public
```

_Simple constructor_

| Name               | Type    | Description                         |
| ------------------ | ------- | ----------------------------------- |
| \_stakingToken     | address | Pool LP token                       |
| \_rewardToken      | address | $AURA                               |
| \_rewardManager    | address | Depositor                           |
| \_auraLocker       | address | $AURA lock contract                 |
| \_penaltyForwarder | address | Address to which penalties are sent |
| \_startDelay       | uint256 |                                     |

### totalSupply

```solidity
function totalSupply() public view returns (uint256)
```

### balanceOf

```solidity
function balanceOf(address account) public view returns (uint256)
```

### updateReward

```solidity
modifier updateReward(address account)
```

### lastTimeRewardApplicable

```solidity
function lastTimeRewardApplicable() public view returns (uint256)
```

### rewardPerToken

```solidity
function rewardPerToken() public view returns (uint256)
```

### earned

```solidity
function earned(address account) public view returns (uint256)
```

### stake

```solidity
function stake(uint256 _amount) public returns (bool)
```

### stakeAll

```solidity
function stakeAll() external returns (bool)
```

### stakeFor

```solidity
function stakeFor(address _for, uint256 _amount) public returns (bool)
```

### withdraw

```solidity
function withdraw(uint256 amount, bool claim, bool lock) public returns (bool)
```

### getReward

```solidity
function getReward(bool _lock) public returns (bool)
```

_Gives a staker their rewards_

| Name   | Type | Description                                     |
| ------ | ---- | ----------------------------------------------- |
| \_lock | bool | Lock the rewards? If false, takes a 20% haircut |

### forwardPenalty

```solidity
function forwardPenalty() public
```

_Forwards to the penalty forwarder for distro to Aura Lockers_

### rescueReward

```solidity
function rescueReward() public
```

_Rescues the reward token provided it hasn't been initiated yet_

### setLocker

```solidity
function setLocker(address _newLocker) external
```

_Updates the locker address_

### initialiseRewards

```solidity
function initialiseRewards() external returns (bool)
```

_Called once to initialise the rewards based on balance of stakeToken_

## IBasicRewards

### getReward

```solidity
function getReward(address _account, bool _claimExtras) external
```

### getReward

```solidity
function getReward(address _account) external
```

### getReward

```solidity
function getReward(address _account, address _token) external
```

### stakeFor

```solidity
function stakeFor(address, uint256) external
```

## AuraClaimZap

Claim zap to bundle various reward claims

_Claims from all pools, and stakes cvxCrv and CVX if wanted.
v2: - change exchange to use curve pool - add getReward(address,token) type - add option to lock cvx - add option use all funds in wallet_

### crv

```solidity
address crv
```

### cvx

```solidity
address cvx
```

### cvxCrv

```solidity
address cvxCrv
```

### crvDepositWrapper

```solidity
address crvDepositWrapper
```

### cvxCrvRewards

```solidity
address cvxCrvRewards
```

### locker

```solidity
address locker
```

### owner

```solidity
address owner
```

### Options

```solidity
enum Options {
    ClaimCvxCrv,
    ClaimLockedCvx,
    ClaimLockedCvxStake,
    LockCrvDeposit,
    UseAllWalletFunds,
    LockCvx
}

```

### constructor

```solidity
constructor(address _crv, address _cvx, address _cvxCrv, address _crvDepositWrapper, address _cvxCrvRewards, address _locker) public
```

| Name                | Type    | Description                                                     |
| ------------------- | ------- | --------------------------------------------------------------- |
| \_crv               | address | CRV token (0xD533a949740bb3306d119CC777fa900bA034cd52);         |
| \_cvx               | address | CVX token (0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B);         |
| \_cvxCrv            | address | cvxCRV token (0x62B9c7356A2Dc64a1969e19C23e4f579F9810Aa7);      |
| \_crvDepositWrapper | address | crvDepositWrapper (0x8014595F2AB54cD7c604B00E9fb932176fDc86Ae); |
| \_cvxCrvRewards     | address | cvxCrvRewards (0x3Fe65692bfCD0e6CF84cB1E7d24108E434A7587e);     |
| \_locker            | address | vlCVX (0xD18140b4B819b895A3dba5442F959fA44994AF50);             |

### getName

```solidity
function getName() external pure returns (string)
```

### setApprovals

```solidity
function setApprovals() external
```

Approve spending of:
crv -> crvDepositor
cvxCrv -> cvxCrvRewards
cvx -> Locker

### \_checkOption

```solidity
function _checkOption(uint256 _mask, uint256 _flag) internal pure returns (bool)
```

Use bitmask to check if option flag is set

### claimRewards

```solidity
function claimRewards(address[] rewardContracts, address[] extraRewardContracts, address[] tokenRewardContracts, address[] tokenRewardTokens, uint256 depositCrvMaxAmount, uint256 minAmountOut, uint256 depositCvxMaxAmount, uint256 options) external
```

Claim all the rewards

| Name                 | Type      | Description                                                                                                                    |
| -------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| rewardContracts      | address[] | Array of addresses for LP token rewards                                                                                        |
| extraRewardContracts | address[] | Array of addresses for extra rewards                                                                                           |
| tokenRewardContracts | address[] | Array of addresses for token rewards e.g vlCvxExtraRewardDistribution                                                          |
| tokenRewardTokens    | address[] | Array of token reward addresses to use with tokenRewardContracts                                                               |
| depositCrvMaxAmount  | uint256   | The max amount of CRV to deposit if converting to crvCvx                                                                       |
| minAmountOut         | uint256   | The min amount out for crv:cvxCrv swaps if swapping. Set this to zero if you want to use CrvDepositor instead of balancer swap |
| depositCvxMaxAmount  | uint256   | The max amount of CVX to deposit if locking CVX                                                                                |
| options              | uint256   | Claim options                                                                                                                  |

### \_claimExtras

```solidity
function _claimExtras(uint256 depositCrvMaxAmount, uint256 minAmountOut, uint256 depositCvxMaxAmount, uint256 removeCrvBalance, uint256 removeCvxBalance, uint256 options) internal
```

Claim additional rewards from: - cvxCrvRewards - cvxLocker

| Name                | Type    | Description                                                   |
| ------------------- | ------- | ------------------------------------------------------------- |
| depositCrvMaxAmount | uint256 | see claimRewards                                              |
| minAmountOut        | uint256 | see claimRewards                                              |
| depositCvxMaxAmount | uint256 | see claimRewards                                              |
| removeCrvBalance    | uint256 | crvBalance to ignore and not redeposit (starting Crv balance) |
| removeCvxBalance    | uint256 | cvxBalance to ignore and not redeposit (starting Cvx balance) |
| options             | uint256 | see claimRewards                                              |

## IRewardStaking

### stakeFor

```solidity
function stakeFor(address, uint256) external
```

## AuraLocker

Effectively allows for rolling 16 week lockups of CVX, and provides balances available
at each epoch (1 week). Also receives cvxCrv from `CvxStakingProxy` and redistributes
to depositors.

_Individual and delegatee vote power lookups both use independent accounting mechanisms._

### RewardData

```solidity
struct RewardData {
    uint32 periodFinish;
    uint32 lastUpdateTime;
    uint96 rewardRate;
    uint96 rewardPerTokenStored;
}

```

### UserData

```solidity
struct UserData {
    uint128 rewardPerTokenPaid;
    uint128 rewards;
}

```

### EarnedData

```solidity
struct EarnedData {
    address token;
    uint256 amount;
}

```

### Balances

```solidity
struct Balances {
    uint112 locked;
    uint32 nextUnlockIndex;
}

```

### LockedBalance

```solidity
struct LockedBalance {
    uint112 amount;
    uint32 unlockTime;
}

```

### Epoch

```solidity
struct Epoch {
    uint224 supply;
    uint32 date;
}

```

### DelegateeCheckpoint

```solidity
struct DelegateeCheckpoint {
    uint224 votes;
    uint32 epochStart;
}

```

### rewardTokens

```solidity
address[] rewardTokens
```

### queuedRewards

```solidity
mapping(address => uint256) queuedRewards
```

### newRewardRatio

```solidity
uint256 newRewardRatio
```

### rewardData

```solidity
mapping(address => struct AuraLocker.RewardData) rewardData
```

### rewardDistributors

```solidity
mapping(address => mapping(address => bool)) rewardDistributors
```

### userData

```solidity
mapping(address => mapping(address => struct AuraLocker.UserData)) userData
```

### rewardsDuration

```solidity
uint256 rewardsDuration
```

### lockDuration

```solidity
uint256 lockDuration
```

### lockedSupply

```solidity
uint256 lockedSupply
```

### epochs

```solidity
struct AuraLocker.Epoch[] epochs
```

### balances

```solidity
mapping(address => struct AuraLocker.Balances) balances
```

### userLocks

```solidity
mapping(address => struct AuraLocker.LockedBalance[]) userLocks
```

### \_delegates

```solidity
mapping(address => address) _delegates
```

### \_checkpointedVotes

```solidity
mapping(address => struct AuraLocker.DelegateeCheckpoint[]) _checkpointedVotes
```

### delegateeUnlocks

```solidity
mapping(address => mapping(uint256 => uint256)) delegateeUnlocks
```

### blacklist

```solidity
mapping(address => bool) blacklist
```

### stakingToken

```solidity
contract IERC20 stakingToken
```

### cvxCrv

```solidity
address cvxCrv
```

### denominator

```solidity
uint256 denominator
```

### cvxcrvStaking

```solidity
address cvxcrvStaking
```

### kickRewardPerEpoch

```solidity
uint256 kickRewardPerEpoch
```

### kickRewardEpochDelay

```solidity
uint256 kickRewardEpochDelay
```

### isShutdown

```solidity
bool isShutdown
```

### \_name

```solidity
string _name
```

### \_symbol

```solidity
string _symbol
```

### \_decimals

```solidity
uint8 _decimals
```

### DelegateChanged

```solidity
event DelegateChanged(address delegator, address fromDelegate, address toDelegate)
```

### DelegateCheckpointed

```solidity
event DelegateCheckpointed(address delegate)
```

### Recovered

```solidity
event Recovered(address _token, uint256 _amount)
```

### RewardPaid

```solidity
event RewardPaid(address _user, address _rewardsToken, uint256 _reward)
```

### Staked

```solidity
event Staked(address _user, uint256 _paidAmount, uint256 _lockedAmount)
```

### Withdrawn

```solidity
event Withdrawn(address _user, uint256 _amount, bool _relocked)
```

### KickReward

```solidity
event KickReward(address _user, address _kicked, uint256 _reward)
```

### RewardAdded

```solidity
event RewardAdded(address _token, uint256 _reward)
```

### BlacklistModified

```solidity
event BlacklistModified(address account, bool blacklisted)
```

### KickIncentiveSet

```solidity
event KickIncentiveSet(uint256 rate, uint256 delay)
```

### Shutdown

```solidity
event Shutdown()
```

### constructor

```solidity
constructor(string _nameArg, string _symbolArg, address _stakingToken, address _cvxCrv, address _cvxCrvStaking) public
```

| Name            | Type    | Description                                                 |
| --------------- | ------- | ----------------------------------------------------------- |
| \_nameArg       | string  | Token name, simples                                         |
| \_symbolArg     | string  | Token symbol                                                |
| \_stakingToken  | address | CVX (0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B)            |
| \_cvxCrv        | address | cvxCRV (0x62B9c7356A2Dc64a1969e19C23e4f579F9810Aa7)         |
| \_cvxCrvStaking | address | cvxCRV rewards (0x3Fe65692bfCD0e6CF84cB1E7d24108E434A7587e) |

### updateReward

```solidity
modifier updateReward(address _account)
```

### notBlacklisted

```solidity
modifier notBlacklisted(address _sender, address _receiver)
```

### modifyBlacklist

```solidity
function modifyBlacklist(address _account, bool _blacklisted) external
```

### addReward

```solidity
function addReward(address _rewardsToken, address _distributor) external
```

### approveRewardDistributor

```solidity
function approveRewardDistributor(address _rewardsToken, address _distributor, bool _approved) external
```

### setKickIncentive

```solidity
function setKickIncentive(uint256 _rate, uint256 _delay) external
```

### shutdown

```solidity
function shutdown() external
```

### recoverERC20

```solidity
function recoverERC20(address _tokenAddress, uint256 _tokenAmount) external
```

### setApprovals

```solidity
function setApprovals() external
```

### lock

```solidity
function lock(address _account, uint256 _amount) external
```

### \_lock

```solidity
function _lock(address _account, uint256 _amount) internal
```

### getReward

```solidity
function getReward(address _account) external
```

### getReward

```solidity
function getReward(address _account, bool _stake) public
```

### getReward

```solidity
function getReward(address _account, bool[] _skipIdx) external
```

### checkpointEpoch

```solidity
function checkpointEpoch() external
```

### \_checkpointEpoch

```solidity
function _checkpointEpoch() internal
```

### processExpiredLocks

```solidity
function processExpiredLocks(bool _relock) external
```

### kickExpiredLocks

```solidity
function kickExpiredLocks(address _account) external
```

### emergencyWithdraw

```solidity
function emergencyWithdraw() external
```

### \_processExpiredLocks

```solidity
function _processExpiredLocks(address _account, bool _relock, address _rewardAddress, uint256 _checkDelay) internal
```

### delegate

```solidity
function delegate(address newDelegatee) external virtual
```

_Delegate votes from the sender to `newDelegatee`._

### \_checkpointDelegate

```solidity
function _checkpointDelegate(address _account, uint256 _upcomingAddition, uint256 _upcomingDeduction) internal
```

### delegates

```solidity
function delegates(address account) public view virtual returns (address)
```

_Get the address `account` is currently delegating to._

### getVotes

```solidity
function getVotes(address account) external view returns (uint256)
```

_Gets the current votes balance for `account`_

### checkpoints

```solidity
function checkpoints(address account, uint32 pos) external view virtual returns (struct AuraLocker.DelegateeCheckpoint)
```

_Get the `pos`-th checkpoint for `account`._

### numCheckpoints

```solidity
function numCheckpoints(address account) external view virtual returns (uint32)
```

_Get number of checkpoints for `account`._

### getPastVotes

```solidity
function getPastVotes(address account, uint256 timestamp) public view returns (uint256 votes)
```

_Retrieve the number of votes for `account` at the end of `blockNumber`._

### getPastTotalSupply

```solidity
function getPastTotalSupply(uint256 timestamp) external view returns (uint256)
```

_Retrieve the `totalSupply` at the end of `timestamp`. Note, this value is the sum of all balances.
It is but NOT the sum of all the delegated votes!_

### \_checkpointsLookup

```solidity
function _checkpointsLookup(struct AuraLocker.DelegateeCheckpoint[] ckpts, uint256 epochStart) private view returns (struct AuraLocker.DelegateeCheckpoint)
```

_Lookup a value in a list of (sorted) checkpoints.
Copied from oz/ERC20Votes.sol_

### balanceOf

```solidity
function balanceOf(address _user) external view returns (uint256 amount)
```

### balanceAtEpochOf

```solidity
function balanceAtEpochOf(uint256 _epoch, address _user) public view returns (uint256 amount)
```

### lockedBalances

```solidity
function lockedBalances(address _user) external view returns (uint256 total, uint256 unlockable, uint256 locked, struct AuraLocker.LockedBalance[] lockData)
```

### totalSupply

```solidity
function totalSupply() external view returns (uint256 supply)
```

### totalSupplyAtEpoch

```solidity
function totalSupplyAtEpoch(uint256 _epoch) public view returns (uint256 supply)
```

### findEpochId

```solidity
function findEpochId(uint256 _time) public view returns (uint256 epoch)
```

### epochCount

```solidity
function epochCount() external view returns (uint256)
```

### decimals

```solidity
function decimals() external view returns (uint8)
```

### name

```solidity
function name() external view returns (string)
```

### symbol

```solidity
function symbol() external view returns (string)
```

### claimableRewards

```solidity
function claimableRewards(address _account) external view returns (struct AuraLocker.EarnedData[] userRewards)
```

### lastTimeRewardApplicable

```solidity
function lastTimeRewardApplicable(address _rewardsToken) external view returns (uint256)
```

### rewardPerToken

```solidity
function rewardPerToken(address _rewardsToken) external view returns (uint256)
```

### \_earned

```solidity
function _earned(address _user, address _rewardsToken, uint256 _balance) internal view returns (uint256)
```

### \_lastTimeRewardApplicable

```solidity
function _lastTimeRewardApplicable(uint256 _finishTime) internal view returns (uint256)
```

### \_rewardPerToken

```solidity
function _rewardPerToken(address _rewardsToken) internal view returns (uint256)
```

### queueNewRewards

```solidity
function queueNewRewards(address _rewardsToken, uint256 _rewards) external
```

### \_notifyReward

```solidity
function _notifyReward(address _rewardsToken, uint256 _reward) internal
```

## AuraMath

A library for performing overflow-/underflow-safe math,
updated with awesomeness from of DappHub (https://github.com/dapphub/ds-math).

### min

```solidity
function min(uint256 a, uint256 b) internal pure returns (uint256)
```

_Returns the smallest of two numbers._

### add

```solidity
function add(uint256 a, uint256 b) internal pure returns (uint256 c)
```

### sub

```solidity
function sub(uint256 a, uint256 b) internal pure returns (uint256 c)
```

### mul

```solidity
function mul(uint256 a, uint256 b) internal pure returns (uint256 c)
```

### div

```solidity
function div(uint256 a, uint256 b) internal pure returns (uint256)
```

### average

```solidity
function average(uint256 a, uint256 b) internal pure returns (uint256)
```

_Returns the average of two numbers. The result is rounded towards
zero._

### to224

```solidity
function to224(uint256 a) internal pure returns (uint224 c)
```

### to128

```solidity
function to128(uint256 a) internal pure returns (uint128 c)
```

### to112

```solidity
function to112(uint256 a) internal pure returns (uint112 c)
```

### to96

```solidity
function to96(uint256 a) internal pure returns (uint96 c)
```

### to32

```solidity
function to32(uint256 a) internal pure returns (uint32 c)
```

## AuraMath32

A library for performing overflow-/underflow-safe addition and subtraction on uint32.

### sub

```solidity
function sub(uint32 a, uint32 b) internal pure returns (uint32 c)
```

## AuraMath112

A library for performing overflow-/underflow-safe addition and subtraction on uint112.

### add

```solidity
function add(uint112 a, uint112 b) internal pure returns (uint112 c)
```

### sub

```solidity
function sub(uint112 a, uint112 b) internal pure returns (uint112 c)
```

## AuraMath224

A library for performing overflow-/underflow-safe addition and subtraction on uint224.

### add

```solidity
function add(uint224 a, uint224 b) internal pure returns (uint224 c)
```

## AuraMerkleDrop

_Forked from convex-platform/contracts/contracts/MerkleAirdrop.sol. Changes: - solc 0.8.11 & OpenZeppelin MerkleDrop - Delayed start w/ trigger - EndTime for withdrawal to treasuryDAO - Penalty on claim & AuraLocker lock (only if address(auraLocker) != 0) - Non custodial (cannot change root)_

### dao

```solidity
address dao
```

### merkleRoot

```solidity
bytes32 merkleRoot
```

### aura

```solidity
contract IERC20 aura
```

### auraLocker

```solidity
contract IAuraLocker auraLocker
```

### penaltyForwarder

```solidity
address penaltyForwarder
```

### pendingPenalty

```solidity
uint256 pendingPenalty
```

### deployTime

```solidity
uint256 deployTime
```

### startTime

```solidity
uint256 startTime
```

### expiryTime

```solidity
uint256 expiryTime
```

### hasClaimed

```solidity
mapping(address => bool) hasClaimed
```

### DaoSet

```solidity
event DaoSet(address newDao)
```

### RootSet

```solidity
event RootSet(bytes32 newRoot)
```

### StartedEarly

```solidity
event StartedEarly()
```

### ExpiredWithdrawn

```solidity
event ExpiredWithdrawn(uint256 amount)
```

### LockerSet

```solidity
event LockerSet(address newLocker)
```

### Claimed

```solidity
event Claimed(address addr, uint256 amt, bool locked)
```

### PenaltyForwarded

```solidity
event PenaltyForwarded(uint256 amount)
```

### Rescued

```solidity
event Rescued()
```

### constructor

```solidity
constructor(address _dao, bytes32 _merkleRoot, address _aura, address _auraLocker, address _penaltyForwarder, uint256 _startDelay, uint256 _expiresAfter) public
```

| Name               | Type    | Description               |
| ------------------ | ------- | ------------------------- |
| \_dao              | address | The Aura Dao              |
| \_merkleRoot       | bytes32 | Merkle root               |
| \_aura             | address | Aura token                |
| \_auraLocker       | address | Aura locker contract      |
| \_penaltyForwarder | address | PenaltyForwarded contract |
| \_startDelay       | uint256 | Delay until claim is live |
| \_expiresAfter     | uint256 | Timestamp claim expires   |

### setDao

```solidity
function setDao(address _newDao) external
```

### setRoot

```solidity
function setRoot(bytes32 _merkleRoot) external
```

### startEarly

```solidity
function startEarly() external
```

### withdrawExpired

```solidity
function withdrawExpired() external
```

### setLocker

```solidity
function setLocker(address _newLocker) external
```

### rescueReward

```solidity
function rescueReward() public
```

### claim

```solidity
function claim(bytes32[] _proof, uint256 _amount, bool _lock) public returns (bool)
```

### forwardPenalty

```solidity
function forwardPenalty() public
```

## AuraMinter

Wraps the AuraToken minterMint function and protects from inflation until
3 years have passed.

_Ownership initially owned by the DAO, but likely transferred to smart contract
wrapper or additional value system at some stage as directed by token holders._

### aura

```solidity
contract AuraToken aura
```

_Aura token_

### inflationProtectionTime

```solidity
uint256 inflationProtectionTime
```

_Timestamp upon which minting will be possible_

### constructor

```solidity
constructor(address _aura, address _dao) public
```

### mint

```solidity
function mint(address _to, uint256 _amount) external
```

_Mint function allows the owner of the contract to inflate AURA post protection time_

| Name     | Type    | Description       |
| -------- | ------- | ----------------- |
| \_to     | address | Recipient address |
| \_amount | uint256 | Amount of tokens  |

## AuraPenaltyForwarder

_Receives a given token and forwards it on to a distribution contract._

### distributor

```solidity
contract IExtraRewardsDistributor distributor
```

### token

```solidity
contract IERC20 token
```

### distributionDelay

```solidity
uint256 distributionDelay
```

### lastDistribution

```solidity
uint256 lastDistribution
```

### Forwarded

```solidity
event Forwarded(uint256 amount)
```

### DistributorChanged

```solidity
event DistributorChanged(address newDistributor)
```

### constructor

```solidity
constructor(address _distributor, address _token, uint256 _delay, address _dao) public
```

_During deployment approves the distributor to spend all tokens_

| Name          | Type    | Description                             |
| ------------- | ------- | --------------------------------------- |
| \_distributor | address | Contract that will distribute tokens    |
| \_token       | address | Token to be distributed                 |
| \_delay       | uint256 | Delay between each distribution trigger |
| \_dao         | address | Address of DAO                          |

### forward

```solidity
function forward() public
```

_Forwards the complete balance of token in this contract to the distributor_

### setDistributor

```solidity
function setDistributor(address _distributor) public
```

_Updates distributor address_

## AuraStakingProxy

Receives CRV from the Booster as overall reward, then distributes to vlCVX holders. Also
acts as a depositor proxy to support deposit/withdrawals from the CVX staking contract.

_From CVX: - receive tokens to stake - get current staked balance - withdraw staked tokens - send rewards back to owner(cvx locker) - register token types that can be distributed_

### crv

```solidity
address crv
```

### cvx

```solidity
address cvx
```

### cvxCrv

```solidity
address cvxCrv
```

### keeper

```solidity
address keeper
```

### crvDepositorWrapper

```solidity
address crvDepositorWrapper
```

### outputBps

```solidity
uint256 outputBps
```

### denominator

```solidity
uint256 denominator
```

### rewards

```solidity
address rewards
```

### owner

```solidity
address owner
```

### pendingOwner

```solidity
address pendingOwner
```

### callIncentive

```solidity
uint256 callIncentive
```

### RewardsDistributed

```solidity
event RewardsDistributed(address token, uint256 amount)
```

### CallIncentiveChanged

```solidity
event CallIncentiveChanged(uint256 incentive)
```

### constructor

```solidity
constructor(address _rewards, address _crv, address _cvx, address _cvxCrv, address _crvDepositorWrapper, uint256 _outputBps) public
```

| Name                  | Type    | Description                                      |
| --------------------- | ------- | ------------------------------------------------ |
| \_rewards             | address | vlCVX                                            |
| \_crv                 | address | CRV token                                        |
| \_cvx                 | address | CVX token                                        |
| \_cvxCrv              | address | cvxCRV token                                     |
| \_crvDepositorWrapper | address | Wrapper that converts CRV to CRVBPT and deposits |
| \_outputBps           | uint256 | Configurable output bps where 100% == 10000      |

### setCrvDepositorWrapper

```solidity
function setCrvDepositorWrapper(address _crvDepositorWrapper, uint256 _outputBps) external
```

Set CrvDepositorWrapper

| Name                  | Type    | Description                 |
| --------------------- | ------- | --------------------------- |
| \_crvDepositorWrapper | address | CrvDepositorWrapper address |
| \_outputBps           | uint256 | Min output base points      |

### setKeeper

```solidity
function setKeeper(address _keeper) external
```

Set keeper

### setPendingOwner

```solidity
function setPendingOwner(address _po) external
```

Set pending owner

### applyPendingOwner

```solidity
function applyPendingOwner() external
```

Apply pending owner

### setCallIncentive

```solidity
function setCallIncentive(uint256 _incentive) external
```

Set call incentive

| Name        | Type    | Description           |
| ----------- | ------- | --------------------- |
| \_incentive | uint256 | Incentive base points |

### setRewards

```solidity
function setRewards(address _rewards) external
```

Set reward address

### setApprovals

```solidity
function setApprovals() external
```

Approve crvDepositorWrapper to transfer contract CRV
and rewards to transfer cvxCrv

### rescueToken

```solidity
function rescueToken(address _token, address _to) external
```

Transfer stuck ERC20 tokens to `_to`

### distribute

```solidity
function distribute(uint256 _minOut) external
```

### distribute

```solidity
function distribute() external
```

_Collects cvxCRV rewards from cvxRewardPool, converts any CRV deposited directly from
the booster, and then applies the rewards to the cvxLocker, rewarding the caller in the process._

### \_distribute

```solidity
function _distribute(uint256 _minOut) internal
```

### distributeOther

```solidity
function distributeOther(contract IERC20 _token) external
```

Allow generic token distribution in case a new reward is ever added

## AuraVestedEscrow

Vests tokens over a given timeframe to an array of recipients. Allows locking of
these tokens directly to staking contract.

_Adaptations: - One time initialisation - Consolidation of fundAdmin/admin - Lock in AuraLocker by default - Start and end time_

### rewardToken

```solidity
contract IERC20 rewardToken
```

### admin

```solidity
address admin
```

### funder

```solidity
address funder
```

### auraLocker

```solidity
contract IAuraLocker auraLocker
```

### startTime

```solidity
uint256 startTime
```

### endTime

```solidity
uint256 endTime
```

### totalTime

```solidity
uint256 totalTime
```

### initialised

```solidity
bool initialised
```

### totalLocked

```solidity
mapping(address => uint256) totalLocked
```

### totalClaimed

```solidity
mapping(address => uint256) totalClaimed
```

### Funded

```solidity
event Funded(address recipient, uint256 reward)
```

### Cancelled

```solidity
event Cancelled(address recipient)
```

### Claim

```solidity
event Claim(address user, uint256 amount, bool locked)
```

### constructor

```solidity
constructor(address rewardToken_, address admin_, address auraLocker_, uint256 starttime_, uint256 endtime_) public
```

| Name          | Type    | Description                              |
| ------------- | ------- | ---------------------------------------- |
| rewardToken\_ | address | Reward token (AURA)                      |
| admin\_       | address | Admin to cancel rewards                  |
| auraLocker\_  | address | Contract where rewardToken can be staked |
| starttime\_   | uint256 | Timestamp when claim starts              |
| endtime\_     | uint256 | When vesting ends                        |

### setAdmin

```solidity
function setAdmin(address _admin) external
```

Change contract admin

| Name    | Type    | Description       |
| ------- | ------- | ----------------- |
| \_admin | address | New admin address |

### setLocker

```solidity
function setLocker(address _auraLocker) external
```

Change locker contract address

| Name         | Type    | Description         |
| ------------ | ------- | ------------------- |
| \_auraLocker | address | Aura Locker address |

### fund

```solidity
function fund(address[] _recipient, uint256[] _amount) external
```

Fund recipients with rewardTokens

| Name        | Type      | Description                                  |
| ----------- | --------- | -------------------------------------------- |
| \_recipient | address[] | Array of recipients to vest rewardTokens for |
| \_amount    | uint256[] | Arrary of amount of rewardTokens to vest     |

### cancel

```solidity
function cancel(address _recipient) external
```

Cancel recipients vesting rewardTokens

| Name        | Type    | Description       |
| ----------- | ------- | ----------------- |
| \_recipient | address | Recipient address |

### available

```solidity
function available(address _recipient) public view returns (uint256)
```

Available amount to claim

| Name        | Type    | Description         |
| ----------- | ------- | ------------------- |
| \_recipient | address | Recipient to lookup |

### remaining

```solidity
function remaining(address _recipient) public view returns (uint256)
```

Total remaining vested amount

| Name        | Type    | Description         |
| ----------- | ------- | ------------------- |
| \_recipient | address | Recipient to lookup |

### \_totalVestedOf

```solidity
function _totalVestedOf(address _recipient, uint256 _time) internal view returns (uint256 total)
```

Get total amount vested for this timestamp

| Name        | Type    | Description                           |
| ----------- | ------- | ------------------------------------- |
| \_recipient | address | Recipient to lookup                   |
| \_time      | uint256 | Timestamp to check vesting amount for |

### claim

```solidity
function claim(bool _lock) external
```

### \_claim

```solidity
function _claim(address _recipient, bool _lock) internal
```

_Claim reward token (Aura) and lock it._

| Name        | Type    | Description                 |
| ----------- | ------- | --------------------------- |
| \_recipient | address | Address to receive rewards. |
| \_lock      | bool    | Lock rewards immediately.   |

## BalInvestor

Deposits $BAL into a BAL/WETH BPT. Hooks into TWAP to determine minOut.

_Abstract contract for depositing BAL -> balBPT -> auraBAL via crvDepositor_

### BALANCER_VAULT

```solidity
contract IVault BALANCER_VAULT
```

### BAL

```solidity
address BAL
```

### WETH

```solidity
address WETH
```

### BALANCER_POOL_TOKEN

```solidity
address BALANCER_POOL_TOKEN
```

### BAL_ETH_POOL_ID

```solidity
bytes32 BAL_ETH_POOL_ID
```

### constructor

```solidity
constructor(contract IVault _balancerVault, address _bal, address _weth, bytes32 _balETHPoolId) internal
```

### \_setApprovals

```solidity
function _setApprovals() internal
```

### \_getBptPrice

```solidity
function _getBptPrice() internal view returns (uint256)
```

### \_getMinOut

```solidity
function _getMinOut(uint256 amount, uint256 minOutBps) internal view returns (uint256)
```

### \_investBalToPool

```solidity
function _investBalToPool(uint256 amount, uint256 minOut) internal
```

## BalLiquidityProvider

Provides initial liquidity to a Balancer pool on behalf of a given DAO

### startToken

```solidity
contract IERC20 startToken
```

### pairToken

```solidity
contract IERC20 pairToken
```

### minPairAmount

```solidity
uint256 minPairAmount
```

### provider

```solidity
address provider
```

### dao

```solidity
address dao
```

### bVault

```solidity
contract IVault bVault
```

### LiquidityProvided

```solidity
event LiquidityProvided(uint256[] input, uint256 output)
```

### MinPairAmountChanged

```solidity
event MinPairAmountChanged(uint256 oldMinPairAmount, uint256 newMinPairAmount)
```

### constructor

```solidity
constructor(address _startToken, address _pairToken, uint256 _minPairAmount, address _dao, address _bVault) public
```

### provideLiquidity

```solidity
function provideLiquidity(bytes32 _poolId, struct IVault.JoinPoolRequest _request) public
```

_Provides liquidity on behalf of the dao, in a non-custodial manner.
Has protections in place to ensure that no erroneous liquidity data gets added._

### changeMinPairAmount

```solidity
function changeMinPairAmount(uint256 _newAmount) external
```

_Allows the DAO to change the minimum amount of the pair token that must be added as liquidity_

### rescueToken

```solidity
function rescueToken(address _erc20, uint256 _amount) external
```

_Rescues a given token from the contract.
Only provider or DAO can call this function._

## IBooster

### PoolInfo

```solidity
struct PoolInfo {
    address lptoken;
    address token;
    address gauge;
    address crvRewards;
    address stash;
    bool shutdown;
}

```

### earmarkRewards

```solidity
function earmarkRewards(uint256 _pid) external returns (bool)
```

### poolInfo

```solidity
function poolInfo(uint256 _pid) external returns (struct IBooster.PoolInfo poolInfo)
```

## IBaseRewardPool

### processIdleRewards

```solidity
function processIdleRewards() external
```

## BoosterHelper

Invokes booster.earmarkRewards for multiple pools.

_Allows anyone to call `earmarkRewards` via the booster._

### booster

```solidity
contract IBooster booster
```

### crv

```solidity
address crv
```

### constructor

```solidity
constructor(address _booster, address _crv) public
```

| Name      | Type    | Description                                                  |
| --------- | ------- | ------------------------------------------------------------ |
| \_booster | address | Booster.sol, e.g. 0xF403C135812408BFbE8713b5A23a04b3D48AAE31 |
| \_crv     | address | Crv e.g. 0xba100000625a3754423978a60c9317c58a424e3D          |

### earmarkRewards

```solidity
function earmarkRewards(uint256[] _pids) external returns (uint256)
```

### processIdleRewards

```solidity
function processIdleRewards(uint256[] _pids) external
```

Invoke processIdleRewards for each pool id.

| Name   | Type      | Description       |
| ------ | --------- | ----------------- |
| \_pids | uint256[] | Array of pool ids |

## IChef

### deposit

```solidity
function deposit(uint256, uint256) external
```

### claim

```solidity
function claim(uint256, address) external
```

## ChefForwarder

### pid

```solidity
uint256 pid
```

### briber

```solidity
address briber
```

### chef

```solidity
address chef
```

### constructor

```solidity
constructor(address _chef) public
```

### setBriber

```solidity
function setBriber(address _briber) external
```

### setPid

```solidity
function setPid(uint256 _pid) external
```

### deposit

```solidity
function deposit(address siphonToken) external
```

### claim

```solidity
function claim(address token) external
```

## IBooster

### FeeDistro

```solidity
struct FeeDistro {
    address distro;
    address rewards;
    bool active;
}

```

### earmarkFees

```solidity
function earmarkFees(address _feeDistro) external returns (bool)
```

### feeTokens

```solidity
function feeTokens(address _token) external returns (struct IBooster.FeeDistro)
```

## ClaimFeesHelper

Claim vecrv fees and distribute

_Allows anyone to call `claimFees` that will basically collect any 3crv and distribute to cvxCrv
via the booster._

### booster

```solidity
contract IBooster booster
```

### voterProxy

```solidity
address voterProxy
```

### lastTokenTimes

```solidity
mapping(address => uint256) lastTokenTimes
```

### feeDistro

```solidity
contract IFeeDistributor feeDistro
```

### constructor

```solidity
constructor(address _booster, address _voterProxy, address _feeDistro) public
```

| Name         | Type    | Description                                                    |
| ------------ | ------- | -------------------------------------------------------------- |
| \_booster    | address | Booster.sol, e.g. 0xF403C135812408BFbE8713b5A23a04b3D48AAE31   |
| \_voterProxy | address | CVX VoterProxy e.g. 0x989AEb4d175e16225E39E87d0D97A3360524AD80 |
| \_feeDistro  | address | FeeDistro e.g. 0xD3cf852898b21fc233251427c2DC93d3d604F3BB      |

### claimFees

```solidity
function claimFees(contract IERC20[] _tokens, uint256 _checkpoints) external
```

_Claims fees from fee claimer, and pings the booster to distribute._

| Name          | Type              | Description                                            |
| ------------- | ----------------- | ------------------------------------------------------ |
| \_tokens      | contract IERC20[] | Token address to claim fees for.                       |
| \_checkpoints | uint256           | Number of checkpoints required previous to claim fees. |

## ICrvDepositor

### depositFor

```solidity
function depositFor(address to, uint256 _amount, bool _lock, address _stakeAddress) external
```

## CrvDepositorWrapper

Converts BAL -> balBPT and then wraps to auraBAL via the crvDepositor

### crvDeposit

```solidity
address crvDeposit
```

### constructor

```solidity
constructor(address _crvDeposit, contract IVault _balancerVault, address _bal, address _weth, bytes32 _balETHPoolId) public
```

### setApprovals

```solidity
function setApprovals() external
```

### getMinOut

```solidity
function getMinOut(uint256 _amount, uint256 _outputBps) external view returns (uint256)
```

_Gets minimum output based on BPT oracle price_

| Name        | Type    | Description                                                   |
| ----------- | ------- | ------------------------------------------------------------- |
| \_amount    | uint256 | Units of BAL to deposit                                       |
| \_outputBps | uint256 | Multiplier where 100% == 10000, 99.5% == 9950 and 98% == 9800 |

| Name | Type    | Description                             |
| ---- | ------- | --------------------------------------- |
| [0]  | uint256 | minOut Units of BPT to expect as output |

### deposit

```solidity
function deposit(uint256 _amount, uint256 _minOut, bool _lock, address _stakeAddress) external
```

## ExtraRewardsDistributor

Allows anyone to distribute rewards to the AuraLocker at a given epoch.

### auraLocker

```solidity
contract IAuraLocker auraLocker
```

### canAddReward

```solidity
mapping(address => bool) canAddReward
```

### rewardData

```solidity
mapping(address => mapping(uint256 => uint256)) rewardData
```

### rewardEpochs

```solidity
mapping(address => uint256[]) rewardEpochs
```

### userClaims

```solidity
mapping(address => mapping(address => uint256)) userClaims
```

### WhitelistModified

```solidity
event WhitelistModified(address user, bool canAdd)
```

### RewardAdded

```solidity
event RewardAdded(address token, uint256 epoch, uint256 reward)
```

### RewardPaid

```solidity
event RewardPaid(address user, address token, uint256 reward, uint256 index)
```

### RewardForfeited

```solidity
event RewardForfeited(address user, address token, uint256 index)
```

### constructor

```solidity
constructor(address _auraLocker) public
```

_Simple constructor_

| Name         | Type    | Description         |
| ------------ | ------- | ------------------- |
| \_auraLocker | address | Aura Locker address |

### modifyWhitelist

```solidity
function modifyWhitelist(address _depositor, bool _canAdd) external
```

### addReward

```solidity
function addReward(address _token, uint256 _amount) external
```

Add a reward to the current epoch. can be called multiple times for the same reward token

| Name     | Type    | Description             |
| -------- | ------- | ----------------------- |
| \_token  | address | Reward token address    |
| \_amount | uint256 | Amount of reward tokenπ |

### addRewardToEpoch

```solidity
function addRewardToEpoch(address _token, uint256 _amount, uint256 _epoch) external
```

Add reward token to a specific epoch

| Name     | Type    | Description                                                  |
| -------- | ------- | ------------------------------------------------------------ |
| \_token  | address | Reward token address                                         |
| \_amount | uint256 | Amount of reward tokens to add                               |
| \_epoch  | uint256 | Which epoch to add to (must be less than the previous epoch) |

### \_addReward

```solidity
function _addReward(address _token, uint256 _amount, uint256 _epoch) internal
```

Transfer reward tokens from sender to contract for vlCVX holders

_Add reward token for specific epoch_

| Name     | Type    | Description             |
| -------- | ------- | ----------------------- |
| \_token  | address | Reward token address    |
| \_amount | uint256 | Amount of reward tokens |
| \_epoch  | uint256 | Epoch to add tokens to  |

### getReward

```solidity
function getReward(address _account, address _token) public
```

Claim rewards for a specific token since the first epoch.

| Name      | Type    | Description             |
| --------- | ------- | ----------------------- |
| \_account | address | Address of vlCVX holder |
| \_token   | address | Reward token address    |

### getReward

```solidity
function getReward(address _token, uint256 _startIndex) public
```

Claim rewards for a specific token at a specific epoch

| Name         | Type    | Description                                                      |
| ------------ | ------- | ---------------------------------------------------------------- |
| \_token      | address | Reward token address                                             |
| \_startIndex | uint256 | Index of rewardEpochs[_token] to start checking for rewards from |

### \_getReward

```solidity
function _getReward(address _account, address _token, uint256 _startIndex) internal
```

Claim rewards for a specific token at a specific epoch

| Name         | Type    | Description                                                      |
| ------------ | ------- | ---------------------------------------------------------------- |
| \_account    | address | Address of vlCVX holder                                          |
| \_token      | address | Reward token address                                             |
| \_startIndex | uint256 | Index of rewardEpochs[_token] to start checking for rewards from |

### forfeitRewards

```solidity
function forfeitRewards(address _token, uint256 _index) external
```

Allow a user to set their claimed index forward without claiming rewards
Because claims cycle through all periods that a specific reward was given
there becomes a situation where, for example, a new user could lock
2 years from now and try to claim a token that was given out every week prior.
This would result in a 2mil gas checkpoint.(about 20k gas _ 52 weeks _ 2 years)

| Name    | Type    | Description                 |
| ------- | ------- | --------------------------- |
| \_token | address | Reward token to forfeit     |
| \_index | uint256 | Epoch index to forfeit from |

### claimableRewards

```solidity
function claimableRewards(address _account, address _token) external view returns (uint256)
```

Get claimable rewards (rewardToken) for vlCVX holder

| Name      | Type    | Description             |
| --------- | ------- | ----------------------- |
| \_account | address | Address of vlCVX holder |
| \_token   | address | Reward token address    |

### claimableRewardsAtEpoch

```solidity
function claimableRewardsAtEpoch(address _account, address _token, uint256 _epoch) external view returns (uint256)
```

Get claimable rewards for a token at a specific epoch

| Name      | Type    | Description                    |
| --------- | ------- | ------------------------------ |
| \_account | address | Address of vlCVX holder        |
| \_token   | address | Reward token address           |
| \_epoch   | uint256 | The epoch to check for rewards |

### \_allClaimableRewards

```solidity
function _allClaimableRewards(address _account, address _token, uint256 _startIndex) internal view returns (uint256, uint256)
```

Get all claimable rewards by looping through each epoch starting with the latest
saved epoch the user last claimed from

| Name         | Type    | Description                                                      |
| ------------ | ------- | ---------------------------------------------------------------- |
| \_account    | address | Address of vlCVX holder                                          |
| \_token      | address | Reward token                                                     |
| \_startIndex | uint256 | Index of rewardEpochs[_token] to start checking for rewards from |

### \_claimableRewards

```solidity
function _claimableRewards(address _account, address _token, uint256 _epoch) internal view returns (uint256)
```

Get claimable rewards for a token at a specific epoch

| Name      | Type    | Description                    |
| --------- | ------- | ------------------------------ |
| \_account | address | Address of vlCVX holder        |
| \_token   | address | Reward token address           |
| \_epoch   | uint256 | The epoch to check for rewards |

### rewardEpochsCount

```solidity
function rewardEpochsCount(address _token) external view returns (uint256)
```

Simply gets the current epoch count for a given reward token

| Name    | Type    | Description          |
| ------- | ------- | -------------------- |
| \_token | address | Reward token address |

| Name | Type    | Description               |
| ---- | ------- | ------------------------- |
| [0]  | uint256 | \_epochs Number of epochs |

## IPriceOracle

### OracleAverageQuery

```solidity
struct OracleAverageQuery {
  enum IPriceOracle.Variable variable;
  uint256 secs;
  uint256 ago;
}
```

### Variable

```solidity
enum Variable {
    PAIR_PRICE,
    BPT_PRICE,
    INVARIANT
}

```

### getTimeWeightedAverage

```solidity
function getTimeWeightedAverage(struct IPriceOracle.OracleAverageQuery[] queries) external view returns (uint256[] results)
```

## IVault

### PoolSpecialization

```solidity
enum PoolSpecialization {
    GENERAL,
    MINIMAL_SWAP_INFO,
    TWO_TOKEN
}

```

### JoinKind

```solidity
enum JoinKind {
    INIT,
    EXACT_TOKENS_IN_FOR_BPT_OUT,
    TOKEN_IN_FOR_EXACT_BPT_OUT,
    ALL_TOKENS_IN_FOR_EXACT_BPT_OUT
}

```

### SwapKind

```solidity
enum SwapKind {
    GIVEN_IN,
    GIVEN_OUT
}

```

### SingleSwap

```solidity
struct SingleSwap {
  bytes32 poolId;
  enum IVault.SwapKind kind;
  contract IAsset assetIn;
  contract IAsset assetOut;
  uint256 amount;
  bytes userData;
}
```

### FundManagement

```solidity
struct FundManagement {
    address sender;
    bool fromInternalBalance;
    address payable recipient;
    bool toInternalBalance;
}

```

### JoinPoolRequest

```solidity
struct JoinPoolRequest {
  contract IAsset[] assets;
  uint256[] maxAmountsIn;
  bytes userData;
  bool fromInternalBalance;
}
```

### getPool

```solidity
function getPool(bytes32 poolId) external view returns (address, enum IVault.PoolSpecialization)
```

### getPoolTokens

```solidity
function getPoolTokens(bytes32 poolId) external view returns (address[] tokens, uint256[] balances, uint256 lastChangeBlock)
```

### joinPool

```solidity
function joinPool(bytes32 poolId, address sender, address recipient, struct IVault.JoinPoolRequest request) external payable
```

### swap

```solidity
function swap(struct IVault.SingleSwap singleSwap, struct IVault.FundManagement funds, uint256 limit, uint256 deadline) external returns (uint256 amountCalculated)
```

### exitPool

```solidity
function exitPool(bytes32 poolId, address sender, address payable recipient, struct IVault.ExitPoolRequest request) external
```

### getInternalBalance

```solidity
function getInternalBalance(address user, address[] tokens) external view returns (uint256[])
```

### ExitPoolRequest

```solidity
struct ExitPoolRequest {
  contract IAsset[] assets;
  uint256[] minAmountsOut;
  bytes userData;
  bool toInternalBalance;
}
```

### ExitKind

```solidity
enum ExitKind {
    EXACT_BPT_IN_FOR_ONE_TOKEN_OUT,
    EXACT_BPT_IN_FOR_TOKENS_OUT,
    BPT_IN_FOR_EXACT_TOKENS_OUT,
    MANAGEMENT_FEE_TOKENS_OUT
}

```

## IAsset

## IAuraLocker

### lock

```solidity
function lock(address _account, uint256 _amount) external
```

### checkpointEpoch

```solidity
function checkpointEpoch() external
```

### epochCount

```solidity
function epochCount() external view returns (uint256)
```

### balanceAtEpochOf

```solidity
function balanceAtEpochOf(uint256 _epoch, address _user) external view returns (uint256 amount)
```

### totalSupplyAtEpoch

```solidity
function totalSupplyAtEpoch(uint256 _epoch) external view returns (uint256 supply)
```

### queueNewRewards

```solidity
function queueNewRewards(address _rewardsToken, uint256 reward) external
```

### getReward

```solidity
function getReward(address _account, bool _stake) external
```

### getReward

```solidity
function getReward(address _account) external
```

## IExtraRewardsDistributor

### addReward

```solidity
function addReward(address _token, uint256 _amount) external
```

## ICrvDepositorWrapper

### getMinOut

```solidity
function getMinOut(uint256, uint256) external view returns (uint256)
```

### deposit

```solidity
function deposit(uint256, uint256, bool, address _stakeAddress) external
```

## IChef

### deposit

```solidity
function deposit(uint256, uint256) external
```

### claim

```solidity
function claim(uint256, address) external
```

## MasterChefRewardHook

### pid

```solidity
uint256 pid
```

### stash

```solidity
address stash
```

### chef

```solidity
address chef
```

### rewardToken

```solidity
address rewardToken
```

### constructor

```solidity
constructor(address _stash, address _chef, address _rewardToken) public
```

### setPid

```solidity
function setPid(uint256 _pid) external
```

### deposit

```solidity
function deposit(address siphonToken) external
```

### onRewardClaim

```solidity
function onRewardClaim() external
```

## RewardPool

### deposit

```solidity
function deposit(uint256 assets, address receiver) external returns (uint256 shares)
```

## RewardPoolDepositWrapper

Peripheral contract that allows users to deposit into a Balancer pool and then stake their BPT
into Aura in 1 tx. Flow: - rawToken.transferFrom(user, address(this)) - vault.deposit(rawToken), receive poolToken - poolToken.approve(rewardPool) - rewardPool.deposit(poolToken), converts to auraBPT and then deposits

### bVault

```solidity
contract IVault bVault
```

### constructor

```solidity
constructor(address _bVault) public
```

### depositSingle

```solidity
function depositSingle(address _rewardPoolAddress, contract IERC20 _inputToken, uint256 _inputAmount, bytes32 _balancerPoolId, struct IVault.JoinPoolRequest _request) external
```

_Deposits a single raw token into a BPT before depositing in reward pool.
Requires sender to approve this contract before calling._

## SiphonToken

### constructor

```solidity
constructor(address to, uint256 amount) public
```

## MockAuraLockor

_Modifications from convex-platform/contracts/contracts/BaseRewardPool.sol: - Delayed start (tokens transferred then delay is enforced before notification) - One time duration of 14 days - Remove child reward contracts - Penalty on claim at 20%_

### aura

```solidity
contract IERC20 aura
```

### locker

```solidity
contract IAuraLocker locker
```

### constructor

```solidity
constructor(address _aura, address _locker) public
```

### lock

```solidity
function lock(uint256 _amount) external
```

### lockFor

```solidity
function lockFor(address _for, uint256 _amount) external
```

## MockAuraMath

### constructor

```solidity
constructor() public
```

### AuraMath_min

```solidity
function AuraMath_min(uint256 a, uint256 b) external pure returns (uint256)
```

### AuraMath_add

```solidity
function AuraMath_add(uint256 a, uint256 b) external pure returns (uint256)
```

### AuraMath_sub

```solidity
function AuraMath_sub(uint256 a, uint256 b) external pure returns (uint256)
```

### AuraMath_mul

```solidity
function AuraMath_mul(uint256 a, uint256 b) external pure returns (uint256)
```

### AuraMath_div

```solidity
function AuraMath_div(uint256 a, uint256 b) external pure returns (uint256)
```

### AuraMath_average

```solidity
function AuraMath_average(uint256 a, uint256 b) external pure returns (uint256)
```

### AuraMath_to224

```solidity
function AuraMath_to224(uint256 a) external pure returns (uint224)
```

### AuraMath_to128

```solidity
function AuraMath_to128(uint256 a) external pure returns (uint128)
```

### AuraMath_to112

```solidity
function AuraMath_to112(uint256 a) external pure returns (uint112)
```

### AuraMath_to96

```solidity
function AuraMath_to96(uint256 a) external pure returns (uint96)
```

### AuraMath_to32

```solidity
function AuraMath_to32(uint256 a) external pure returns (uint32)
```

### AuraMath32_sub

```solidity
function AuraMath32_sub(uint32 a, uint32 b) external pure returns (uint32)
```

### AuraMath112_add

```solidity
function AuraMath112_add(uint112 a, uint112 b) external pure returns (uint112)
```

### AuraMath112_sub

```solidity
function AuraMath112_sub(uint112 a, uint112 b) external pure returns (uint112)
```

### AuraMath224_add

```solidity
function AuraMath224_add(uint224 a, uint224 b) external pure returns (uint224)
```

## MockBalInvestor

### constructor

```solidity
constructor(contract IVault _balancerVault, address _bal, address _weth, bytes32 _balETHPoolId) public
```

### approveToken

```solidity
function approveToken() external
```

### getBptPrice

```solidity
function getBptPrice() external view returns (uint256)
```

### getMinOut

```solidity
function getMinOut(uint256 _amount, uint256 _outputBps) public view returns (uint256)
```

### addBalToPool

```solidity
function addBalToPool(uint256 amount, uint256 _minOut) external
```

## IBalancerPool

### getPoolId

```solidity
function getPoolId() external view returns (bytes32)
```

### getNormalizedWeights

```solidity
function getNormalizedWeights() external view returns (uint256[])
```

### getSwapEnabled

```solidity
function getSwapEnabled() external view returns (bool)
```

### getOwner

```solidity
function getOwner() external view returns (address)
```

## MockBalancerPoolToken

### OracleAverageQuery

```solidity
struct OracleAverageQuery {
  enum MockBalancerPoolToken.Variable variable;
  uint256 secs;
  uint256 ago;
}
```

### Variable

```solidity
enum Variable {
    PAIR_PRICE,
    BPT_PRICE,
    INVARIANT
}

```

### dec

```solidity
uint8 dec
```

### price

```solidity
uint256 price
```

### constructor

```solidity
constructor(uint8 _decimals, address _initialRecipient, uint256 _initialMint) public
```

### mint

```solidity
function mint(address to, uint256 amount) external
```

### setPrice

```solidity
function setPrice(uint256 _price) external
```

### getTimeWeightedAverage

```solidity
function getTimeWeightedAverage(struct MockBalancerPoolToken.OracleAverageQuery[]) external view returns (uint256[])
```

## IBalancerVault

### joinPool

```solidity
function joinPool(bytes32 poolId, address sender, address recipient, struct IBalancerVault.JoinPoolRequest request) external payable
```

### JoinPoolRequest

```solidity
struct JoinPoolRequest {
    address[] assets;
    uint256[] maxAmountsIn;
    bytes userData;
    bool fromInternalBalance;
}

```

## MockBalancerVault

### pool

```solidity
address pool
```

### poolToken

```solidity
address poolToken
```

### tokenA

```solidity
address tokenA
```

### tokenB

```solidity
address tokenB
```

### constructor

```solidity
constructor(address _poolToken) public
```

### setTokens

```solidity
function setTokens(address _tokenA, address _tokenB) external
```

### getPool

```solidity
function getPool(bytes32) external view returns (address, enum IVault.PoolSpecialization)
```

### joinPool

```solidity
function joinPool(bytes32, address, address recipient, struct IVault.JoinPoolRequest request) external payable
```

### swap

```solidity
function swap(struct IVault.SingleSwap singleSwap, struct IVault.FundManagement funds, uint256, uint256) external returns (uint256 amountCalculated)
```

## IFeeDistributor

### claimToken

```solidity
function claimToken(address user, contract IERC20 token) external returns (uint256)
```

### claimTokens

```solidity
function claimTokens(address user, contract IERC20[] tokens) external returns (uint256[])
```

### getTokenTimeCursor

```solidity
function getTokenTimeCursor(contract IERC20 token) external view returns (uint256)
```

### checkpointUser

```solidity
function checkpointUser(address user) external
```

### getUserTimeCursor

```solidity
function getUserTimeCursor(address user) external view returns (uint256)
```

### getTimeCursor

```solidity
function getTimeCursor() external view returns (uint256)
```

### depositToken

```solidity
function depositToken(contract IERC20 token, uint256 amount) external
```

### getNextNonce

```solidity
function getNextNonce(address) external view returns (uint256)
```

### setOnlyCallerCheckWithSignature

```solidity
function setOnlyCallerCheckWithSignature(address, bool, bytes) external
```

## MockFeeDistributor

### tokenRates

```solidity
mapping(address => uint256) tokenRates
```

### constructor

```solidity
constructor(address[] _tokens, uint256[] _rates) public
```

### claimToken

```solidity
function claimToken(address user, contract IERC20 token) external returns (uint256)
```

### \_claimToken

```solidity
function _claimToken(address user, contract IERC20 token) internal returns (uint256)
```

### claimTokens

```solidity
function claimTokens(address user, contract IERC20[] tokens) external returns (uint256[])
```

### getTokenTimeCursor

```solidity
function getTokenTimeCursor(contract IERC20) external pure returns (uint256)
```

### checkpointUser

```solidity
function checkpointUser(address user) external
```

### getUserTimeCursor

```solidity
function getUserTimeCursor(address user) external view returns (uint256)
```

### getTimeCursor

```solidity
function getTimeCursor() external view returns (uint256)
```

### depositToken

```solidity
function depositToken(contract IERC20 token, uint256 amount) external
```

### getNextNonce

```solidity
function getNextNonce(address) external view returns (uint256)
```

### setOnlyCallerCheckWithSignature

```solidity
function setOnlyCallerCheckWithSignature(address, bool, bytes) external
```

## ILBPFactory

### create

```solidity
function create(string name, string symbol, contract IERC20[] tokens, uint256[] weights, uint256 swapFeePercentage, address owner, bool swapEnabledOnStart) external returns (address)
```

## ILBP

### setSwapEnabled

```solidity
function setSwapEnabled(bool swapEnabled) external
```

### updateWeightsGradually

```solidity
function updateWeightsGradually(uint256 startTime, uint256 endTime, uint256[] endWeights) external
```

### getGradualWeightUpdateParams

```solidity
function getGradualWeightUpdateParams() external view returns (uint256 startTime, uint256 endTime, uint256[] endWeights)
```

## IStablePoolFactory

### create

```solidity
function create(string name, string symbol, contract IERC20[] tokens, uint256 amplificationParameter, uint256 swapFeePercentage, address owner) external returns (address)
```

## IWeightedPool2TokensFactory

### create

```solidity
function create(string name, string symbol, contract IERC20[] tokens, uint256[] weights, uint256 swapFeePercentage, bool oracleEnabled, address owner) external returns (address)
```

## MockCurveGauge

### lp_token

```solidity
address lp_token
```

### reward_tokens

```solidity
address[] reward_tokens
```

### constructor

```solidity
constructor(string _name, string _symbol, address _lptoken, address[] _rewardTokens) public
```

### deposit

```solidity
function deposit(uint256 amount) external
```

### withdraw

```solidity
function withdraw(uint256 amount) external
```

### claim_rewards

```solidity
function claim_rewards() external
```

### claimable_reward

```solidity
function claimable_reward(address, address) external pure returns (uint256)
```

### deposit_reward_token

```solidity
function deposit_reward_token(address, uint256) external
```

### add_reward

```solidity
function add_reward(address, address) external
```

### is_killed

```solidity
function is_killed() external view returns (bool)
```

## IMinter

### mint

```solidity
function mint(address) external
```

## MockCurveMinter

### crv

```solidity
contract IERC20 crv
```

### rate

```solidity
uint256 rate
```

### constructor

```solidity
constructor(address _crv, uint256 _rate) public
```

### setRate

```solidity
function setRate(uint256 _rate) external
```

### mint

```solidity
function mint(address) external
```

## MockCurveVoteEscrow

### smart_wallet_checker

```solidity
address smart_wallet_checker
```

### token

```solidity
address token
```

### lockAmounts

```solidity
mapping(address => uint256) lockAmounts
```

### lockTimes

```solidity
mapping(address => uint256) lockTimes
```

### MAX_LEN

```solidity
uint256 MAX_LEN
```

### constructor

```solidity
constructor(address _smart_wallet_checker, address _token) public
```

### transfer

```solidity
function transfer(address, uint256) public virtual returns (bool)
```

### transferFrom

```solidity
function transferFrom(address, address, uint256) public virtual returns (bool)
```

### create_lock

```solidity
function create_lock(uint256 amount, uint256 unlockTime) external
```

### increase_amount

```solidity
function increase_amount(uint256 amount) external
```

### increase_unlock_time

```solidity
function increase_unlock_time(uint256 time) external
```

### withdraw

```solidity
function withdraw() external
```

## MockERC20

### dec

```solidity
uint8 dec
```

### constructor

```solidity
constructor(string _name, string _symbol, uint8 _decimals, address _initialRecipient, uint256 _initialMint) public
```

### decimals

```solidity
function decimals() public view returns (uint8)
```

\_Returns the number of decimals used to get its user representation.
For example, if `decimals` equals `2`, a balance of `505` tokens should
be displayed to a user as `5.05` (`505 / 10 ** 2`).

Tokens usually opt for a value of 18, imitating the relationship between
Ether and Wei. This is the value {ERC20} uses, unless this function is
overridden;

NOTE: This information is only used for _display_ purposes: it in
no way affects any of the arithmetic of the contract, including
{IERC20-balanceOf} and {IERC20-transfer}.\_

### mint

```solidity
function mint(uint256 amount) public
```

## MockWalletChecker

### wallets

```solidity
mapping(address => bool) wallets
```

### approveWallet

```solidity
function approveWallet(address wallet) external
```

### check

```solidity
function check(address wallet) external view returns (bool)
```

## MockVoting

### gaugeWeights

```solidity
mapping(address => uint256) gaugeWeights
```

### votesFor

```solidity
mapping(uint256 => uint256) votesFor
```

### votesAgainst

```solidity
mapping(uint256 => uint256) votesAgainst
```

### VotedSlope

```solidity
struct VotedSlope {
    uint256 slope;
    uint256 power;
    uint256 end;
}

```

### vote

```solidity
function vote(uint256 voteId, bool support, bool) external
```

### vote_for_gauge_weights

```solidity
function vote_for_gauge_weights(address gauge, uint256 weight) external
```

### get_gauge_weight

```solidity
function get_gauge_weight(address gauge) external view returns (uint256)
```

### vote_user_slopes

```solidity
function vote_user_slopes(address, address) external pure returns (struct MockVoting.VotedSlope)
```

### vote_user_power

```solidity
function vote_user_power(address) external pure returns (uint256)
```

### last_user_vote

```solidity
function last_user_vote(address, address) external pure returns (uint256)
```

## MockVoteStorage

### Vote

```solidity
struct Vote {
    uint256 timestamp;
    uint256 choice;
    string version;
    string space;
    string voteType;
}

```

### proposals

```solidity
mapping(string => struct MockVoteStorage.Vote) proposals
```

### setProposal

```solidity
function setProposal(uint256 choice, uint256 timestamp, string version, string proposal, string space, string voteType) external
```

### hash

```solidity
function hash(string proposal) public view returns (bytes32)
```

### payloadStr

```solidity
function payloadStr(string proposal, uint256 choice) internal pure returns (string)
```

### hashStr

```solidity
function hashStr(string str) internal pure returns (bytes32)
```

### uint2str

```solidity
function uint2str(uint256 _i) internal pure returns (string _uintAsString)
```
