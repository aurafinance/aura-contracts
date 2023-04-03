// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { ProxyOFT } from "../layerzero/token/oft/extension/ProxyOFT.sol";
import { CrossChainMessages as CCM } from "./CrossChainMessages.sol";

/**
 * @title AuraOFT
 * @dev Sends AURA to all the Sidechains and tracks the amount of fee debt
 */
contract AuraOFT is ProxyOFT {
    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */

    /// @dev src chain ID mapped to feeDebt
    mapping(uint16 => uint256) public feeDebt;

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    constructor(address _lzEndpoint, address _token) ProxyOFT(_lzEndpoint, _token) {}

    /* -------------------------------------------------------------------
       Core Functions
    ------------------------------------------------------------------- */

    /**
     * @dev  Receive an LZ message from the L2 to trigger an
     *       AURA mint using the fee float held by this contract
     *       via the Booster.distributeL2Fees function. Then update
     *       the AURA rate for (TODO: this chain or globally? TBD)
     */
    function _notifyFees(uint16 _srcChainId, uint256 _amount) internal {}

    /**
     * @dev Lock tokens in the Locker contract
     * @param _sender Address that is locking
     * @param _amount Amount to lock
     */
    function _lockFor(address _sender, uint256 _amount) internal {}

    /**
     * @dev Receive CRV from the L2 via some thirdpart bridge
     *      to settle the feeDebt for the remote chain
     */
    function settleFeeDebt(uint256 _srcChainId, uint256 _amount) external {}

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
            // The payload is a specific cross chain message we decode
            // the type to determine what the message is an continue
            CCM.MessageType messageType = CCM.getMessageType(_payload);
            if (messageType == CCM.MessageType.FEES) {
                // Receiving a fees update message from the L2. We decode
                // The payload to get the amount of fees being sent
                uint256 feeAmount = CCM.decodeFees(_payload);
                _notifyFees(_srcChainId, feeAmount);
            } else if (messageType == CCM.MessageType.LOCK) {
                // Receiving a lock request from the L2. We decode
                // The payload to get the sender and the amount to lock
                (address sender, uint256 amount) = CCM.decodeLock(_payload);
                _lockFor(sender, amount);
            }
        } else {
            // The message is not a specific cross chain message so we just
            // fallback to the normal LZ OFT flow
            super._nonblockingLzReceive(_srcChainId, _srcAddress, _nonce, _payload);
        }
    }
}
