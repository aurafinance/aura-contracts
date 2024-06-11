// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { LzApp } from "../layerzero/lzApp/LzApp.sol";
import { IStakelessGauge } from "../interfaces/balancer/IStakelessGauge.sol";
import { IStakelessGaugeCheckpointer } from "../interfaces/balancer/IStakelessGaugeCheckpointer.sol";
import { IBalGaugeController } from "contracts/interfaces/balancer/IBalGaugeController.sol";

/**
 * @title   L1PoolManagerProxy
 * @author  AuraFinance
 * @dev Allows to permissionless add pools on any supported sidechain.
 *      1.  Owner must configure gaugeTypes mapping (lzChainId => balancer gauge type)
 *      2.  User most provide a root gauge address and the layer zero chain id, with enought
 *          native fee to be able to add a pool on the destination chain.
 */
contract L1PoolManagerProxy is LzApp {
    uint256 public constant NO_EXTRA_GAS = 0;
    // packet type
    uint16 public constant PT_SEND = 0;

    /// @dev LayerZero chain ID for this chain
    uint16 public immutable lzChainId;
    /// @dev Gauge controller address
    address public immutable gaugeController;
    /// @dev Gauge controller address
    address public immutable gaugeCheckpointer;
    /// @dev Indicates if add pool is protected or not.
    bool public protectAddPool;
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
        protectAddPool = true;
        gaugeController = _gaugeController;
        gaugeCheckpointer = _gaugeCheckpointer;
    }

    modifier withValidRootGauge(uint16 _dstChainId, address _gauge) {
        //check the destination chain is correct.
        string memory gaugeType = gaugeTypes[_dstChainId];
        require(_dstChainId != lzChainId, "!dstChainId");
        require(bytes(gaugeType).length > 0, "!gaugeType");

        require(IStakelessGaugeCheckpointer(gaugeCheckpointer).hasGauge(gaugeType, _gauge), "!checkpointer");
        //check that the pool as weight
        uint256 weight = IBalGaugeController(gaugeController).get_gauge_weight(_gauge);
        require(weight > 0, "must have weight");
        _;
    }

    receive() external payable {}

    /**
     * @notice set if addPool is only callable by operator
     */
    function setProtectPool(bool _protectAddPool) external onlyOwner {
        protectAddPool = _protectAddPool;
    }

    /**
     * @notice Maps layer zero chain id with balancer gauge type.
     * @param _lzChainId Layer zero chain id.
     * @param gaugeType Balancer gaugeType.
     *
     */
    function setGaugeType(uint16 _lzChainId, string memory gaugeType) external onlyOwner {
        gaugeTypes[_lzChainId] = gaugeType;
    }

    /**
     * @notice Send a message to add a pool on a sidechain.
     * @dev Set adapterParams correctly per dstChainId to provide enough gas to
     * add a pool on the destination chain.
     *
     * @param _gauge              The root gauge address.
     * @param _dstChainId         The LayerZero destination chain ID eg optimism is 111
     * @param _zroPaymentAddress  The LayerZero ZRO payment address
     * @param _adapterParams      The adapter params, very important as default gas limit
     *                             is not enough to add a pool on any sidechain.
     */
    function addPool(
        address _gauge,
        uint16 _dstChainId,
        address _zroPaymentAddress,
        bytes memory _adapterParams
    ) external payable withValidRootGauge(_dstChainId, _gauge) returns (bool) {
        if (protectAddPool) {
            require(msg.sender == owner(), "!auth");
        }
        _checkAdapterParams(_dstChainId, PT_SEND, _adapterParams, NO_EXTRA_GAS);

        address dstGauge = IStakelessGauge(_gauge).getRecipient();
        require(dstGauge != address(0), "!dstGauge");

        _lzSend(
            _dstChainId, ///////////// Destination chain (L2 chain)
            abi.encode(dstGauge), ///////////////// Payload encode
            payable(msg.sender), // Refund address
            _zroPaymentAddress, ////// ZRO payment address
            _adapterParams, ////////// Adapter params
            msg.value //////////////// Native fee
        );
        emit AddSidechainPool(_dstChainId, _gauge, dstGauge);
        return true;
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
