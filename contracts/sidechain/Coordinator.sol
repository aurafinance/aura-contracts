// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { OFT } from "../layerzero/token/oft/OFT.sol";
import { CrossChainMessages as CCM } from "./CrossChainMessages.sol";

/**
 * @title Coordinator
 * @dev Coordinates LZ messages and actions from the L1 on the L2
 */
contract Coordinator is OFT {
    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */

    /// @dev canonical chain ID
    uint16 public immutable canonicalChainId;

    /// @dev Booster contract
    address public booster;

    /// @dev Rate to send CVX on mint
    uint256 public mintRate;

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint,
        uint16 _canonicalChainId
    ) OFT(_name, _symbol, _lzEndpoint) {
        canonicalChainId = _canonicalChainId;
    }

    /* -------------------------------------------------------------------
       Setter Functions
    ------------------------------------------------------------------- */

    function setBooster(address _booster) external {
        // TODO: only owner
        require(booster == address(0), "booster already set");
        booster = _booster;
    }

    /* -------------------------------------------------------------------
       Core Functions
    ------------------------------------------------------------------- */

    /**
     * @dev Mint function called by Booster.rewardClaimed. uses the CVX (L2)
     *      balance of this contract to transfer tokens
     * @param _to     Address to send CVX (L2) to
     * @param _amount Amount of CRV rewardClaimed was called with
     */
    function mint(address _to, uint256 _amount) external {
        require(msg.sender == booster, "!booster");
        uint256 amount = (_amount * mintRate) / 1e18;
        _transfer(address(this), _to, amount);
    }

    /**
     * @dev Called by the booster.earmarkRewards to register feeDebt with the L1
     *      and receive CVX tokens in return
     * @param _rewards Amount of CRV that was received as rewards
     */
    function queueNewRewards(uint256 _rewards, bytes memory _adapterParams) external payable {
        bytes memory payload = CCM.encodeFees(_rewards);

        _lzSend(
            canonicalChainId, ///// Parent chain ID
            payload, ////////////// Payload
            payable(msg.sender), // Refund address
            address(0), /////////// ZRO payment address
            _adapterParams, /////// Adapter params
            msg.value ///////////// Native fee
        );
    }

    /**
     * @dev Lock CVX on the L1 chain
     * @param _cvxAmount Amount of CVX to lock for vlCVX on L1
     * @param _adapterParams LZ adapterParams
     */
    function lock(uint256 _cvxAmount, bytes memory _adapterParams) external payable {
        _debitFrom(msg.sender, canonicalChainId, bytes(""), _cvxAmount);

        bytes memory payload = CCM.encodeLock(msg.sender, _cvxAmount);

        _lzSend(
            canonicalChainId, ///// Parent chain ID
            payload, ////////////// Payload
            payable(msg.sender), // Refund address
            address(0), /////////// ZRO payment address
            _adapterParams, /////// Adapter params
            msg.value ///////////// Native fee
        );
    }

    /* -------------------------------------------------------------------
      Layer Zero functions L1 -> L2
    ------------------------------------------------------------------- */

    /**
     * @dev Override the default OFT lzReceive function logic
     */
    function _nonblockingLzReceive(
        uint16 _srcChainId,
        bytes memory _srcAddress,
        uint64 _nonce,
        bytes memory _payload
    ) internal virtual override {
        if (CCM.isCustomMessage(_payload)) {
            CCM.MessageType messageType = CCM.getMessageType(_payload);
            if (messageType == CCM.MessageType.FEES_CALLBACK) {
                (address toAddress, uint256 cvxAmount, uint256 crvAmount) = CCM.decodeFeesCallback(_payload);

                // The mint rate is the amount of CVX we mint for 1 CRV received
                // It is sent over each time the fee debt is updated on the L1 to try and keep
                // the L2 rate as close as possible to the L1 rate
                mintRate = (cvxAmount * 1e18) / crvAmount;

                // Continue with LZ flow with crvAmount removed from payload
                _payload = abi.encode(PT_SEND, abi.encodePacked(address(0)), abi.encodePacked(toAddress), cvxAmount);
                super._nonblockingLzReceive(_srcChainId, _srcAddress, _nonce, _payload);
            }
        } else {
            super._nonblockingLzReceive(_srcChainId, _srcAddress, _nonce, _payload);
        }
    }
}
