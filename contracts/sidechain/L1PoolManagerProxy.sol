// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { LzApp } from "../layerzero/lzApp/LzApp.sol";

interface IStakelessGauge {
    function getRecipient() external view returns (address);
}

interface IGaugeController {
    function get_gauge_weight(address _gauge) external view returns (uint256);

    function vote_user_slopes(address, address)
        external
        view
        returns (
            uint256,
            uint256,
            uint256
        ); //slope,power,end

    function vote_for_gauge_weights(address, uint256) external;

    function add_gauge(
        address,
        int128,
        uint256
    ) external;

    function gauges(uint256) external view returns (address);

    function checkpoint_gauge(address) external;

    function n_gauges() external view returns (uint256);
}

contract L1PoolManagerProxy is LzApp {
    /// @dev LayerZero chain ID for this chain
    uint16 public immutable lzChainId;
    /// @dev Gauge controller address
    address public immutable gaugeController;
    /// @dev Indicates if add pool is protected or not.
    bool public protectAddPool;

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
     */
    constructor(
        uint16 _lzChainId,
        address _lzEndpoint,
        address _gaugeController
    ) {
        lzChainId = _lzChainId;
        _initializeLzApp(_lzEndpoint);
        protectAddPool = true;
        gaugeController = _gaugeController;
    }

    receive() external payable {}

    /**
     * @notice set if addPool is only callable by operator
     */
    function setProtectPool(bool _protectAddPool) external onlyOwner {
        protectAddPool = _protectAddPool;
    }

    /**
     * @notice Send a message to add a pool on a sidechain.
     * @param _gauge              The root gauge address.
     * @param _dstChainId         The LayerZero destination chain ID eg optimism is 111
     * @param _zroPaymentAddress  The LayerZero ZRO payment address
     * @param _adapterParams      The adapter params
     */
    function addPool(
        address _gauge,
        uint16 _dstChainId,
        address _zroPaymentAddress,
        bytes memory _adapterParams
    ) external payable returns (bool) {
        if (protectAddPool) {
            require(msg.sender == owner(), "!auth");
        }

        require(_dstChainId != lzChainId, "!dstChainId");
        address dstGauge = IStakelessGauge(_gauge).getRecipient();
        require(dstGauge != address(0), "!dstGauge");
        //check that the pool as weight
        uint256 weight = IGaugeController(gaugeController).get_gauge_weight(_gauge);
        require(weight > 0, "must have weight");

        _lzSend(
            _dstChainId, ///////////// Destination chain (L2 chain)
            abi.encode(dstGauge), ///////////////// Payload encode
            payable(address(this)), // Refund address
            _zroPaymentAddress, ////// ZRO payment address
            _adapterParams, ////////// Adapter params
            msg.value //////////////// Native fee
        );
        emit AddSidechainPool(_dstChainId, _gauge, dstGauge);
        return true;
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
