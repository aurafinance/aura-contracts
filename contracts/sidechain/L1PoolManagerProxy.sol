// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { LzApp } from "../layerzero/lzApp/LzApp.sol";

interface IStakelessGauge {
    function getRecipient() external view returns (address);
}

contract L1PoolManagerProxy is LzApp {
    /// @dev LayerZero chain ID for this chain
    uint16 public immutable lzChainId;
    /// @dev Indicates if add pool is protected or not.
    bool public protectAddPool;

    /// @dev Chain ID => ChildGaugeVoteRewards
    mapping(uint16 => address) public getChildGaugeVoteRewards;
    /* -------------------------------------------------------------------
       Events 
    ------------------------------------------------------------------- */
    event AddSidechainPool(uint16 indexed dstChainId, address gauge);

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    /**
     * @param _lzChainId LayerZero chain ID
     * @param _lzEndpoint LayerZero endpoint
     */
    constructor(uint16 _lzChainId, address _lzEndpoint) {
        lzChainId = _lzChainId;
        _initializeLzApp(_lzEndpoint);
        protectAddPool = true;
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
        _lzSend(
            _dstChainId, ///////////// Destination chain (L2 chain)
            abi.encodePacked(dstGauge), ///////////////// Payload encode
            payable(address(this)), // Refund address
            _zroPaymentAddress, ////// ZRO payment address
            _adapterParams, ////////// Adapter params
            msg.value //////////////// Native fee
        );
        emit AddSidechainPool(_dstChainId, _gauge);
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
