// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { LzApp } from "../layerzero/lzApp/LzApp.sol";
import { IStakelessGauge } from "../interfaces/balancer/IStakelessGauge.sol";
import { IStakelessGaugeCheckpointer } from "../interfaces/balancer/IStakelessGaugeCheckpointer.sol";
import { IBalGaugeController } from "contracts/interfaces/balancer/IBalGaugeController.sol";
import { KeeperRole } from "../peripheral/KeeperRole.sol";

/**
 * @title   L1PoolManagerProxy
 * @author  AuraFinance
 * @dev Allows to permissionless add pools on any supported sidechain.
 *      1.  Owner must configure gaugeTypes mapping (lzChainId => balancer gauge type)
 *      2.  User most provide a root gauge address and the layer zero chain id, with enought
 *          native fee to be able to add a pool on the destination chain.
 */
contract L1PoolManagerProxy is LzApp {
    /* -------------------------------------------------------------------
       Storage
    ------------------------------------------------------------------- */

    uint256 public constant NO_EXTRA_GAS = 0;
    // packet type
    uint16 public constant PT_SEND = 0;
    /// @dev LayerZero chain ID for this chain
    uint16 public immutable lzChainId;
    /// @dev Gauge controller address
    address public immutable gaugeController;
    /// @dev Gauge controller address
    address public immutable gaugeCheckpointer;
    /// @dev lzChainId => gauge type
    mapping(uint16 => string) public gaugeTypes;

    /* -------------------------------------------------------------------
       Events
    ------------------------------------------------------------------- */

    event AddSidechainPool(uint16 indexed dstChainId, address rootGauge, address dstGauge);

    /* -------------------------------------------------------------------
       Constructor
    ------------------------------------------------------------------- */

    /**
     * @param _lzChainId LayerZero chain ID
     * @param _lzEndpoint LayerZero endpoint
     * @param _gaugeController Gauge controller address
     * @param _gaugeCheckpointer  Guage checkpointer address
     */
    constructor(
        uint16 _lzChainId,
        address _lzEndpoint,
        address _gaugeController,
        address _gaugeCheckpointer
    ) {
        lzChainId = _lzChainId;
        _initializeLzApp(_lzEndpoint);
        gaugeController = _gaugeController;
        gaugeCheckpointer = _gaugeCheckpointer;
    }

    receive() external payable {}

    /* -------------------------------------------------------------------
       Setter functions
    ------------------------------------------------------------------- */

    /**
     * @notice Maps layer zero chain id with balancer gauge type.
     * @param _lzChainId Layer zero chain id.
     * @param gaugeType Balancer gaugeType.
     *
     */
    function setGaugeType(uint16 _lzChainId, string memory gaugeType) external onlyOwner {
        gaugeTypes[_lzChainId] = gaugeType;
    }

    /* -------------------------------------------------------------------
       Core functions
    ------------------------------------------------------------------- */

    /**
     * @notice Send a message to add a pool on a sidechain.
     * @dev Set adapterParams correctly per dstChainId to provide enough gas to
     * add a pool on the destination chain.
     *
     * @param _gauges             The root gauge addresses.
     * @param _dstChainId         The LayerZero destination chain ID eg optimism is 111
     * @param _zroPaymentAddress  The LayerZero ZRO payment address
     * @param _adapterParams      The adapter params, very important as default gas limit
     *                             is not enough to add a pool on any sidechain.
     */
    function addPools(
        address[] memory _gauges,
        uint16 _dstChainId,
        address _zroPaymentAddress,
        bytes memory _adapterParams
    ) external payable returns (bool) {
        _checkAdapterParams(_dstChainId, PT_SEND, _adapterParams, NO_EXTRA_GAS);
        uint256 gaugesLen = _gauges.length;
        address[] memory dstGauges = new address[](gaugesLen);

        for (uint256 i = 0; i < gaugesLen; i++) {
            address gauge = _gauges[i];
            _checkValidRootGauge(_dstChainId, gauge);

            address dstGauge = IStakelessGauge(gauge).getRecipient();
            require(dstGauge != address(0), "!dstGauge");
            dstGauges[i] = dstGauge;
            emit AddSidechainPool(_dstChainId, gauge, dstGauge);
        }

        _lzSend(
            _dstChainId, ///////////// Destination chain (L2 chain)
            abi.encode(dstGauges), /// Payload encode
            payable(msg.sender), ///// Refund address
            _zroPaymentAddress, ////// ZRO payment address
            _adapterParams, ////////// Adapter params
            msg.value //////////////// Native fee
        );

        return true;
    }

    /* -------------------------------------------------------------------
       Internal functions
    ------------------------------------------------------------------- */

    function _checkValidRootGauge(uint16 _dstChainId, address _gauge) internal view {
        //check the destination chain is correct.
        string memory gaugeType = gaugeTypes[_dstChainId];
        require(_dstChainId != lzChainId, "!dstChainId");
        require(bytes(gaugeType).length > 0, "!gaugeType");

        require(IStakelessGaugeCheckpointer(gaugeCheckpointer).hasGauge(gaugeType, _gauge), "!checkpointer");
        //check that the pool as weight
        uint256 weight = IBalGaugeController(gaugeController).get_gauge_weight(_gauge);
        require(weight > 0, "must have weight");
    }

    function _checkAdapterParams(
        uint16 _dstChainId,
        uint16 _pkType,
        bytes memory _adapterParams,
        uint256 _extraGas
    ) internal view {
        _checkGasLimit(_dstChainId, _pkType, _adapterParams, _extraGas);
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
