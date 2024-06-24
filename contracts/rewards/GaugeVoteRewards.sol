// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { LzApp } from "../layerzero/lzApp/LzApp.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { IOFT } from "../layerzero/token/oft/IOFT.sol";
import { IBooster } from "../interfaces/IBooster.sol";
import { IStashRewardDistro } from "../interfaces/IStashRewardDistro.sol";
import { AuraMath } from "../utils/AuraMath.sol";
import { IStakelessGauge } from "../interfaces/balancer/IStakelessGauge.sol";

/**
 * @title   GaugeVoteRewards
 * @author  Aura Finance
 * @notice  Distribute AURA rewards to each gauge that receives voting weight
 *          for a given epoch.
 *
 *          Gauges receiving votes fall into 3 categories that we need to deal with:
 *          1.  Mainnet gauges with pools on Aura
 *          2.  Sidechain gauges with pools on a sidechain Aura deployment
 *          3.  Gauge that don't take deposits and are not supported by AURA eg veBAL
 *
 *          The process for setting up this contract is:
 *          1.  setRewardPerEpoch(...)
 *          2.  setPoolIds([0...poolLength])
 *          3.  setIsNoDepositGauge(veBAL, veLIT, ...)
 *          4.  setDstChainId([arbGauge, ...], 110)
 *          4.  setDstChainId([optGauge, ...], 111)
 *          4.  setDstChainId([polGauge, ...], 109)
 *          5.  setChildGaugeVoteRewards(...)
 *
 *          The process for each voting epoch (2 weeks) is:
 *          1.  voteGaugeWeight is called with the gauges and weights
 *          2.  processGaugeRewards is called to distribute AURA to the reward distro
 *              for each gauge
 *          3.  processSidechainGaugeRewards sends AURA to sidechain ChildGaugeVoteRewards
 *              along with a payload containing the gauges and amounts to send for the epoch
 */
contract GaugeVoteRewards is LzApp {
    using SafeERC20 for IERC20;
    using AuraMath for uint256;

    /* -------------------------------------------------------------------
       Types 
    ------------------------------------------------------------------- */

    struct Pid {
        uint128 value;
        bool isSet;
    }

    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */

    /// @dev Total vote weight per epoch
    uint256 public constant TOTAL_WEIGHT_PER_EPOCH = 10_000;

    /// @dev Epoch duration
    uint256 public constant EPOCH_DURATION = 2 weeks;

    /// @dev Aura token address
    IERC20 public immutable aura;

    /// @dev Aura OFT token
    IOFT public immutable auraOFT;

    /// @dev The Booster contract address
    IBooster public immutable booster;

    /// @dev Extra reward distro contract
    IStashRewardDistro public immutable stashRewardDistro;

    /// @dev LayerZero chain ID for this chain
    uint16 public immutable lzChainId;

    /// @dev How much total reward per epoch
    uint256 public rewardPerEpoch;

    /// @dev Distributor address
    address public distributor;

    /// @dev Gauge => Src chain ID
    mapping(address => uint16) public getDstChainId;

    /// @dev Chain ID => ChildGaugeVoteRewards
    mapping(uint16 => address) public getChildGaugeVoteRewards;

    /// @dev Gauge => Pool ID
    mapping(address => Pid) public getPoolId;

    /// @dev Epoch => Gauge => Weight
    mapping(uint256 => mapping(address => uint256)) public getWeightByEpoch;

    /// @dev Epoch => Gauge => Has been processed
    mapping(uint256 => mapping(address => bool)) public isProcessed;

    /// @dev Gauge => Is a no deposit gauge like veBAL
    mapping(address => bool) public isNoDepositGauge;

    /// @dev Epoch => total weight
    mapping(uint256 => uint256) public getTotalWeight;

    /* -------------------------------------------------------------------
       Events 
    ------------------------------------------------------------------- */

    event SetDistributor(address distributor);
    event SetRewardPerEpoch(uint256 rewardPerEpoch);
    event SetIsNoDepositGauge(address gauge, bool isNoDeposit);
    event SetChildGaugeVoteRewards(uint16 dstChainId, address voteReward);
    event ProcessGaugeRewards(address[] gauge, uint256 epoch);
    event ProcessSidechainGaugeRewards(address[] gauges, uint256 epoch, uint16 dstChainId);

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    /**
     * @param _aura Aura token
     * @param _auraOFT Aura Proxy OFT token
     * @param _booster Booster contract
     * @param _stashRewardDistro Stash reward distro
     * @param _lzChainId LayerZero chain ID
     * @param _lzEndpoint LayerZero endpoint
     */
    constructor(
        address _aura,
        address _auraOFT,
        address _booster,
        address _stashRewardDistro,
        uint16 _lzChainId,
        address _lzEndpoint
    ) {
        aura = IERC20(_aura);
        auraOFT = IOFT(_auraOFT);
        booster = IBooster(_booster);
        stashRewardDistro = IStashRewardDistro(_stashRewardDistro);
        lzChainId = _lzChainId;

        _initializeLzApp(_lzEndpoint);

        // Approve AuraOFT with AURA
        IERC20(_aura).safeApprove(_auraOFT, type(uint256).max);
        IERC20(_aura).safeApprove(_stashRewardDistro, type(uint256).max);
    }

    receive() external payable {}

    /* -------------------------------------------------------------------
       Modifiers 
    ------------------------------------------------------------------- */

    modifier onlyDistributor() {
        require(msg.sender == distributor, "!distributor");
        _;
    }

    /* -------------------------------------------------------------------
       Setters 
    ------------------------------------------------------------------- */

    /**
     * @dev Set distributor who can process rewards
     * @param _distributor The distributor account
     */
    function setDistributor(address _distributor) external onlyOwner {
        distributor = _distributor;
        emit SetDistributor(_distributor);
    }

    /**
     * @dev Set number of rewards per epoch
     * @param _rewardPerEpoch Reward per epoch
     */
    function setRewardPerEpoch(uint256 _rewardPerEpoch) external onlyOwner {
        rewardPerEpoch = _rewardPerEpoch;
        emit SetRewardPerEpoch(_rewardPerEpoch);
    }

    /**
     * @dev Set if a gauge does not take deposits eg veBAL, veLIT etc
     * @param _gauge Gauge address
     * @param _isNoDeposit If it is a no deposit gauge
     */
    function setIsNoDepositGauge(address _gauge, bool _isNoDeposit) external onlyOwner {
        isNoDepositGauge[_gauge] = _isNoDeposit;
        emit SetIsNoDepositGauge(_gauge, _isNoDeposit);
    }

    /**
     * @dev   Set child gauge vote rewards
     * @dev   This is the contract on the sidechain that AURA is sent to
     *        which then gets sent to the ChildStashRewardDistro
     * @param _dstChainId The dst chain ID
     * @param _voteReward The vote reward contract on the sidechain
     */
    function setChildGaugeVoteRewards(uint16 _dstChainId, address _voteReward) external onlyOwner {
        require(_dstChainId != lzChainId, "!dstChainId");
        getChildGaugeVoteRewards[_dstChainId] = _voteReward;
        emit SetChildGaugeVoteRewards(_dstChainId, _voteReward);
    }

    /**
     * @dev Set the dst chain ID
     * @param _gauges The gauge addresses
     * @param _dstChainId The dst chain ID
     */
    function setDstChainId(address[] memory _gauges, uint16 _dstChainId) external onlyOwner {
        // Local chain dstChainId will be set when the gauge is mapped
        // using the setPoolIds function which queries the booster
        require(_dstChainId != lzChainId, "!localChain");

        for (uint256 i = 0; i < _gauges.length; i++) {
            getDstChainId[_gauges[i]] = _dstChainId;
        }
    }

    /**
     * @dev Loop through the booster pools and configure each one
     * @param start The start index
     * @param end The end index
     */
    function setPoolIds(uint256 start, uint256 end) external {
        for (uint256 i = start; i < end; i++) {
            IBooster.PoolInfo memory poolInfo = booster.poolInfo(i);
            getPoolId[poolInfo.gauge] = Pid(uint128(i), true);
            // Set the dstChainId to be the local chain ID
            if (getDstChainId[poolInfo.gauge] == 0) getDstChainId[poolInfo.gauge] = lzChainId;
        }
    }

    /* -------------------------------------------------------------------
       View 
    ------------------------------------------------------------------- */

    /**
     * @dev Get the current epoch
     */
    function getCurrentEpoch() external view returns (uint256) {
        return _getCurrentEpoch();
    }

    /**
     * @dev Get amount to send for each gauge by epoch
     * @param _epoch Epoch
     * @param _gauge The gauge address
     * @return Amount to send
     */
    function getAmountToSendByEpoch(uint256 _epoch, address _gauge) external view returns (uint256) {
        return _getAmountToSend(_epoch, _gauge);
    }

    /* -------------------------------------------------------------------
       Core 
    ------------------------------------------------------------------- */

    /**
     * @notice  Wraps the booster.voteGaugeWeight call to track weights for each epoch
     *          So AURA rewards can be distributed pro rata to those pool stashes
     * @param _gauge    Array of the gauges
     * @param _weight   Array of the weights
     * @return bool for success
     */
    function voteGaugeWeight(address[] calldata _gauge, uint256[] calldata _weight) external onlyOwner returns (bool) {
        uint256 totalWeight = 0;
        uint256 totalDepositWeight = 0;
        uint256 epoch = _getCurrentEpoch();
        uint256 gaugeLen = _gauge.length;

        require(rewardPerEpoch > 0, "!rewardPerEpoch");
        require(gaugeLen == _weight.length, "!length");
        require(getTotalWeight[epoch] == 0, "already voted");

        // Loop through each gauge and store it's weight for this epoch, while
        // tracking totalWeights that is used for validation and totalDepositsWeight
        // which is used later to calculate pro rata rewards
        for (uint256 i = 0; i < gaugeLen; i++) {
            address gauge = _gauge[i];
            uint256 weight = _weight[i];

            totalWeight = totalWeight.add(weight);

            // Some gauges like veBAL have no deposits so we just skip
            // those special cases
            if (isNoDepositGauge[gauge]) continue;

            // Check that a dstChainId has been configured for this gauge
            // one must be configured before it can enter the reward system
            require(getDstChainId[gauge] != 0, "!dstChainId");

            getWeightByEpoch[epoch][gauge] = weight;
            totalDepositWeight = totalDepositWeight.add(weight);
        }

        // Update the total weight for this epoch
        getTotalWeight[epoch] = totalDepositWeight;

        // Check that the total weight (inclusive of no deposit gauges)
        // reaches 10,000 which is the total vote weight as defined in
        // the GaugeController
        require(totalWeight == TOTAL_WEIGHT_PER_EPOCH, "!totalWeight");

        // Forward the gauge vote to the booster
        return booster.voteGaugeWeight(_gauge, _weight);
    }

    /**
     * @notice Process gauge rewards for the given epoch for mainnet
     * @param _gauge Array of gauges
     * @param _epoch The epoch
     */
    function processGaugeRewards(uint256 _epoch, address[] calldata _gauge) external onlyDistributor {
        require(_epoch <= _getCurrentEpoch(), "!epoch");

        for (uint256 i = 0; i < _gauge.length; i++) {
            address gauge = _gauge[i];

            // This is not a current chain gauge and should be processed by
            // processSidechainGaugeRewards instead this also covers cases
            // where a src chain has not been set for invalid gauges
            require(!isNoDepositGauge[gauge], "noDepositGauge");
            require(getDstChainId[gauge] == lzChainId, "dstChainId!=lzChainId");

            uint256 amountToSend = _calculateAmountToSend(_epoch, gauge);

            // Fund the extra reward distro for the next 2 epochs
            Pid memory pid = getPoolId[gauge];
            require(pid.isSet, "!poolId");

            stashRewardDistro.fundPool(uint256(pid.value), address(aura), amountToSend, 2);
        }

        emit ProcessGaugeRewards(_gauge, _epoch);
    }

    /**
     * @notice Process gauge rewards for the given epoch for sidechains
     * @param _gauge              Array of gauges
     * @param _epoch              The epoch
     * @param _dstChainId         The LayerZero destination chain ID eg optimism is 111
     * @param _zroPaymentAddress  The LayerZero ZRO payment address
     * @param _adapterParams      The adapter params
     */
    function processSidechainGaugeRewards(
        address[] calldata _gauge,
        uint256 _epoch,
        uint16 _dstChainId,
        address _zroPaymentAddress,
        address _sendFromZroPaymentAddress,
        bytes memory _adapterParams,
        bytes memory _sendFromAdapterParams
    ) external payable onlyDistributor {
        address childGaugeVoteRewards = getChildGaugeVoteRewards[_dstChainId];
        require(childGaugeVoteRewards != address(0), "!childGaugeVoteReward");

        uint256 totalAmountToSend = 0;
        uint256 gaugesLen = _gauge.length;
        bytes[] memory payloads = new bytes[](gaugesLen);

        for (uint256 i = 0; i < gaugesLen; i++) {
            address gauge = _gauge[i];

            // Destination chains have to match
            require(getDstChainId[gauge] == _dstChainId, "!dstChainId");

            // Send pro rata AURA to the sidechain
            uint256 amountToSend = _calculateAmountToSend(_epoch, gauge);
            totalAmountToSend = totalAmountToSend.add(amountToSend);

            // Now that the child gauge streamers are deprecated we can make
            // the assumption that the stakeless gauges on mainnet will return
            // the child chain gauge address when calling getRecipient
            address dstGauge = IStakelessGauge(gauge).getRecipient();
            bytes memory gaugePayload = abi.encode(dstGauge, amountToSend);
            payloads[i] = gaugePayload;
        }

        bytes memory payload = abi.encode(_epoch, payloads);

        _lzSend(
            _dstChainId, ///////////// Destination chain (L2 chain)
            payload, ///////////////// Payload
            payable(address(this)), // Refund address
            _zroPaymentAddress, ////// ZRO payment address
            _adapterParams, ////////// Adapter params
            msg.value //////////////// Native fee
        );

        auraOFT.sendFrom{ value: address(this).balance }(
            address(this),
            _dstChainId,
            abi.encodePacked(childGaugeVoteRewards),
            totalAmountToSend,
            payable(msg.sender),
            _sendFromZroPaymentAddress,
            _sendFromAdapterParams
        );

        emit ProcessSidechainGaugeRewards(_gauge, _epoch, _dstChainId);
    }

    /* -------------------------------------------------------------------
       Utils 
    ------------------------------------------------------------------- */

    /**
     * @dev Transfer ERC20
     * @param _token The token address
     * @param _to Address to transfer tokens to
     * @param _amount Amount of tokens to send
     */
    function transferERC20(
        address _token,
        address _to,
        uint256 _amount
    ) external onlyOwner {
        IERC20(_token).safeTransfer(_to, _amount);
    }

    /* -------------------------------------------------------------------
       Internal 
    ------------------------------------------------------------------- */

    function _getAmountToSend(uint256 _epoch, address _gauge) internal view returns (uint256) {
        // Send pro rata AURA to the sidechain
        uint256 weight = getWeightByEpoch[_epoch][_gauge];
        uint256 amountToSend = rewardPerEpoch.mul(weight).div(getTotalWeight[_epoch]);
        return amountToSend;
    }

    function _calculateAmountToSend(uint256 _epoch, address _gauge) internal returns (uint256) {
        // Send pro rata AURA to the sidechain
        uint256 amountToSend = _getAmountToSend(_epoch, _gauge);
        require(amountToSend != 0, "amountToSend=0");

        // Prevent amounts from being sent multiple times
        require(!isProcessed[_epoch][_gauge], "isProcessed");
        isProcessed[_epoch][_gauge] = true;

        return amountToSend;
    }

    function _getCurrentEpoch() internal view returns (uint256) {
        return block.timestamp.div(EPOCH_DURATION);
    }

    function _blockingLzReceive(
        uint16,
        bytes memory,
        uint64,
        bytes memory
    ) internal override {
        // Silence is golden
    }
}
