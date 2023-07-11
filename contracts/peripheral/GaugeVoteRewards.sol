// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { LzApp } from "../layerzero/lzApp/LzApp.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { IOFT } from "../layerzero/token/oft/IOFT.sol";
import { IBooster } from "../interfaces/IBooster.sol";
import { AuraMath } from "../utils/AuraMath.sol";

/**
 * @title   GaugeVoteRewards
 * @author  Aura Finance
 * @notice  Distribute AURA rewards to each gauge that receives voting weight
 *          for a given epoch.
 */
contract GaugeVoteRewards is LzApp {
    using SafeERC20 for IERC20;
    using AuraMath for uint256;

    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */

    // @dev Total vote weight per epoch
    uint256 public constant TOTAL_WEIGHT_PER_EPOCH = 10_000;

    // @dev Epoch duration
    uint256 public constant EPOCH_DURATION = 2 weeks;

    // @dev Aura token address
    IERC20 public immutable aura;

    // @dev Aura OFT token
    IOFT public immutable auraOFT;

    // @dev The Booster contract address
    IBooster public immutable booster;

    // @dev LayerZero chain ID for this chain
    uint16 public immutable lzChainId;

    // @dev How much total reward per epoch
    uint256 public rewardPerEpoch;

    // @dev Distributor address
    address public distributor;

    // @dev Gauge => Src chain ID
    mapping(address => uint16) public getDstChainId;

    // @dev Epoch => Gauge => Amount to send
    mapping(uint256 => mapping(address => uint256)) public getAmountToSendByEpoch;

    // @dev Epoch => Gauge => Amount sent
    mapping(uint256 => mapping(address => uint256)) public getAmountSentByEpoch;

    // @dev Chain ID => ChildGaugeVoteRewards
    mapping(uint16 => address) public getChildGaugeVoteRewards;

    // @dev Gauge => Pool ID
    mapping(address => uint256) public getPoolId;

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    constructor(
        address _aura,
        address _auraOFT,
        address _booster,
        uint16 _lzChainId
    ) {
        aura = IERC20(_aura);
        auraOFT = IOFT(_auraOFT);
        booster = IBooster(_booster);
        lzChainId = _lzChainId;

        // Approve AuraOFT with AURA
        IERC20(_aura).safeApprove(_auraOFT, type(uint256).max);
    }

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

    function setDistributor(address _distributor) external onlyOwner {
        distributor = _distributor;
    }

    function setRewardPerEpoch(uint256 _rewardPerEpoch) external onlyOwner {
        rewardPerEpoch = _rewardPerEpoch;
    }

    function setPoolIds(uint256[] memory _poolIds, address[] memory _gauges) external onlyOwner {
        uint256 poolIdsLen = _poolIds.length;
        for (uint256 i = 0; i < poolIdsLen; i++) {
            getPoolId[_gauges[i]] = _poolIds[i];
        }
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
        // Loop through each gauge and store it's weight for this epoch
        for (uint256 i = 0; i < _gauge.length; i++) {
            address gauge = _gauge[i];
            // If the weight for this gauge for this epoch has already been set then revert
            require(getAmountToSendByEpoch[_getCurrentEpoch()][gauge] == 0, "stored amountToSend!=0");
            uint256 amountToSend = rewardPerEpoch.mul(_weight[i]).div(TOTAL_WEIGHT_PER_EPOCH);
            getAmountToSendByEpoch[_getCurrentEpoch()][gauge] = amountToSend;
        }
        // Forward the gauge vote to the booster
        return booster.voteGaugeWeight(_gauge, _weight);
    }

    /**
     * @notice Process gauge rewards for the given epoch for mainnet
     * @param _gauge Array of gauges
     * @param _epoch The epoch
     */
    function processGaugeRewards(address[] calldata _gauge, uint256 _epoch) external onlyDistributor {
        require(_epoch <= _getCurrentEpoch(), "!epoch");

        for (uint256 i = 0; i < _gauge.length; i++) {
            address gauge = _gauge[i];
            uint16 dstChainId = getDstChainId[gauge];

            // This is not a current chain gauge and should be processed by
            // processSidechainGaugeRewards instead this also covers cases
            // where a src chain has not been set for invalid gauges
            require(dstChainId == lzChainId, "dstChainId!=lzChainId");

            uint256 amountToSend = _getAmountToSend(_epoch, gauge);

            // Get the pool ID and then get the stash address to send
            // Aura to from the Booster pool info
            uint256 pid = getPoolId[gauge];
            IBooster.PoolInfo memory poolInfo = booster.poolInfo(pid);

            // Send the AURA
            aura.safeTransfer(poolInfo.stash, amountToSend);
        }
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
        uint256 totalAmountToSend = 0;
        uint256 gaugesLen = _gauge.length;
        bytes[] memory payloads = new bytes[](gaugesLen);

        for (uint256 i = 0; i < gaugesLen; i++) {
            address gauge = _gauge[i];
            uint16 dstChainId = getDstChainId[gauge];

            // Destination chains have to match
            require(dstChainId == _dstChainId, "!dstChainId");

            // Send pro rata AURA to the sidechain
            uint256 amountToSend = _getAmountToSend(_epoch, gauge);
            totalAmountToSend = totalAmountToSend.add(amountToSend);

            bytes memory gaugePayload = abi.encode(gauge, amountToSend);
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
            abi.encodePacked(getChildGaugeVoteRewards[_dstChainId]),
            totalAmountToSend,
            payable(msg.sender),
            _sendFromZroPaymentAddress,
            _sendFromAdapterParams
        );
    }

    /* -------------------------------------------------------------------
       Internal 
    ------------------------------------------------------------------- */

    function _getAmountToSend(uint256 _epoch, address _gauge) internal returns (uint256) {
        // Send pro rata AURA to the sidechain
        uint256 amountToSend = getAmountToSendByEpoch[_epoch][_gauge];
        require(amountToSend != 0, "amountToSend=0");

        // Prevent amounts from being sent multiple times
        uint256 amountSent = getAmountSentByEpoch[_epoch][_gauge];
        require(amountSent == 0, "amountSent!=0");
        getAmountSentByEpoch[_epoch][_gauge] = amountToSend;

        return amountToSend;
    }

    function _getCurrentEpoch() internal view returns (uint256) {
        return block.timestamp.div(EPOCH_DURATION).mul(EPOCH_DURATION);
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
