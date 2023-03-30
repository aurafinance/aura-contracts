// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { ProxyOFT } from "../layerzero/token/oft/extension/ProxyOFT.sol";
import { CrossChainMessages } from "./CrossChainMessages.sol";

/**
 * @title AuraOFT
 * @dev Sends AURA to all the Sidechains and tracks the amount of fee debt
 */
contract AuraOFT is ProxyOFT {
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
        if (CrossChainMessages.isCustomMessage(_payload)) {
            // TODO:
        } else {
            super._nonblockingLzReceive(_srcChainId, _srcAddress, _nonce, _payload);
        }
    }
}
