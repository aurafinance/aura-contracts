// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { OFT } from "../layerzero/token/oft/OFT.sol";
import { CrossChainMessages } from "./CrossChainMessages.sol";

/**
 * @title Coordinator
 * @dev Coordinates LZ messages and actions from the L1 on the L2
 */
contract Coordinator is OFT {
    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint
    ) OFT(_name, _symbol, _lzEndpoint) {}

    /* -------------------------------------------------------------------
       Core Functions
    ------------------------------------------------------------------- */

    /**
     * @dev Mint function called by Booster.rewardClaimed. uses the CVX (L2)
     *      balance of this contract to transfer tokens
     * @param _to     Address to send CVX (L2) to
     * @param _amount Amount of CRV rewardClaimed was called with
     */
    function mint(address _to, uint256 _amount) external {}

    /**
     * @dev Called by the booster.earmarkRewards to register feeDebt with the L1
     *      and receive CVX tokens in return
     * @param _rewards Amount of CRV that was received as rewards
     */
    function queueNewRewards(uint256 _rewards) external {}

    /**
     * @dev Lock CVX on the L1 chain
     * @param _cvxAmount Amount of CVX to lock for vlCVX on L1
     * @param _adapterParams LZ adapterParams
     */
    function lock(uint256 _cvxAmount, bytes memory _adapterParams) external payable {}

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
