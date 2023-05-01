// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { ProxyOFT } from "../layerzero/token/oft/extension/ProxyOFT.sol";
import { PauseGaurdian } from "./PauseGuardian.sol";
import { AuraMath } from "../utils/AuraMath.sol";
import { BytesLib } from "../layerzero/util/BytesLib.sol";

import "hardhat/console.sol";

/**
 * @title PausableProxyOFT
 */
contract PausableProxyOFT is ProxyOFT, PauseGaurdian {
    using AuraMath for uint256;
    using BytesLib for bytes;

    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */

    /// @dev Duration of each inflow epoch
    uint256 public epochDuration = 7 days;

    /// @dev Transfer inflow limit per epoch
    uint256 public inflowLimit;

    /// @dev Queue delay
    uint256 public queueDelay;

    /// @dev Epoch mapped to transfer outflow
    mapping(uint256 => uint256) public outflow;

    /// @dev Epoch mapped to transfer inflow
    mapping(uint256 => uint256) public inflow;

    /// @dev Transfer queue
    mapping(bytes32 => bool) public queue;

    /* -------------------------------------------------------------------
       Events 
    ------------------------------------------------------------------- */

    /**
     * @param epoch       The epoch
     * @param srcChainId  The source chain
     * @param to          Address to transfer to
     * @param amount      Amount to transfer
     * @param timestamp   Time the transfer was queued
     */
    event QueuedFromChain(uint256 epoch, uint16 srcChainId, address to, uint256 amount, uint256 timestamp);

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    /**
     * @param _lzEndpoint   Layer Zero endpoint contract
     * @param _token        Proxy token (eg AURA or auraBAL)
     * @param _guardian     The pause guardian address
     * @param _inflowLimit  Initial inflow limit per epoch
     */
    constructor(
        address _lzEndpoint,
        address _token,
        address _guardian,
        uint256 _inflowLimit
    ) ProxyOFT(_lzEndpoint, _token) PauseGaurdian(_guardian) {
        inflowLimit = _inflowLimit;
        queueDelay = 7 days;
    }

    /* -------------------------------------------------------------------
       Setters 
    ------------------------------------------------------------------- */

    /**
     * @dev   Amount of time that a transfer has to sit in the queue until
     *        it can be processed
     * @param _delay Queue delay
     */
    function setQueueDelay(uint256 _delay) external onlyOwner {
        queueDelay = _delay;
    }

    /**
     * @dev Set the inflow limit per epoch
     * @param _limit Inflow limit per epoch
     */
    function setInflowLimit(uint256 _limit) external onlyOwner {
        inflowLimit = _limit;
    }

    /* -------------------------------------------------------------------
       View 
    ------------------------------------------------------------------- */

    /**
     * @dev Get current epoch
     */
    function getCurrentEpoch() external view returns (uint256) {
        return _getCurrentEpoch();
    }

    /* -------------------------------------------------------------------
       Core 
    ------------------------------------------------------------------- */

    /**
     * @dev Override sendFrom to add pause modifier
     */
    function sendFrom(
        address _from,
        uint16 _dstChainId,
        bytes calldata _toAddress,
        uint256 _amount,
        address payable _refundAddress,
        address _zroPaymentAddress,
        bytes calldata _adapterParams
    ) public payable override whenNotPaused {
        outflow[_getCurrentEpoch()] += _amount;
        super.sendFrom(_from, _dstChainId, _toAddress, _amount, _refundAddress, _zroPaymentAddress, _adapterParams);
    }

    /**
     * @dev Override _sendAck on OFTCore
     *
     * Add functionality to
     * 1) Pause the bridge
     * 2) Add an inflow limit safety net. This safety net should never get hit in
     *    normal market operations. It's intended to mitigate risk in case of a
     *    doomsday event.
     */
    function _sendAck(
        uint16 _srcChainId,
        bytes memory _srcAddress,
        uint64 _nonce,
        bytes memory _payload
    ) internal override {
        (, bytes memory toAddressBytes, uint256 amount) = abi.decode(_payload, (uint16, bytes, uint256));

        uint256 epoch = _getCurrentEpoch();
        uint256 currInflow = inflow[epoch];
        uint256 newInflow = currInflow.add(amount);
        inflow[epoch] = newInflow;
        address to = toAddressBytes.toAddress(0);

        if (_getNetInflow(newInflow, outflow[epoch]) > inflowLimit || paused()) {
            // If the net inflow is greater than the limit for this epoch OR the bridge
            // is currently paused we send each transfer to a queue for delayed processing.
            // In the case of a doomsday event this limits the exposure to the bridge.
            queue[keccak256(abi.encode(epoch, _srcChainId, to, amount, block.timestamp))] = true;
            emit QueuedFromChain(epoch, _srcChainId, to, amount, block.timestamp);
        } else {
            // Process the transfer as normal
            amount = _creditTo(_srcChainId, to, amount);
            emit ReceiveFromChain(_srcChainId, to, amount);
        }
    }

    /**
     * @dev Process a queued transfer
     *      Transfer has to be a valid root and the queue delay has to have passed
     * @param _epoch        Epoch
     * @param _srcChainId   Source chain ID
     * @param _to           Address to transfer to
     * @param _amount       Amount to transfer
     * @param _timestamp    Time when this transfer was queued
     */
    function processQueued(
        uint256 _epoch,
        uint16 _srcChainId,
        address _to,
        uint256 _amount,
        uint256 _timestamp
    ) external whenNotPaused {
        bytes32 queueRoot = keccak256(abi.encode(_epoch, _srcChainId, _to, _amount, _timestamp));
        require(queue[queueRoot], "!root");
        require(block.timestamp > _timestamp.add(queueDelay), "!timestamp");
        // Process the queued send
        queue[queueRoot] = false;
        uint256 amount = _creditTo(_srcChainId, _to, _amount);
        emit ReceiveFromChain(_srcChainId, _to, _amount);
    }

    /* -------------------------------------------------------------------
       Internal 
    ------------------------------------------------------------------- */

    /**
     * @dev Get current epoch
     */
    function _getCurrentEpoch() internal view returns (uint256) {
        return block.timestamp.div(epochDuration);
    }

    /**
     * @dev Get net inflow
     * @param _inflow   Inflow amount
     * @param _outflow  Outflow amount
     */
    function _getNetInflow(uint256 _inflow, uint256 _outflow) internal view returns (uint256) {
        if (_inflow > _outflow) {
            return _inflow.sub(_outflow);
        }
    }
}
