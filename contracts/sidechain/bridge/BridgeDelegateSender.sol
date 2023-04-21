// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";

/**
 * @title BridgeDelegateSender
 * @dev Sends tokens to L1 via a bridge
 */
abstract contract BridgeDelegateSender is Ownable {
    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */
    address public crv;

    address public l1Receiver;

    address public l2Coordinator;

    /* -------------------------------------------------------------------
       Setter Functions
    ------------------------------------------------------------------- */

    function setL1Receiver(address _l1Receiver) external onlyOwner {
        require(_l1Receiver != address(0), "!0");
        l1Receiver = _l1Receiver;
    }

    function setL2Coordinator(address _l2Coordinator) external onlyOwner {
        require(_l2Coordinator != address(0), "!0");
        l2Coordinator = _l2Coordinator;
    }

    function send(address _to, uint256 _amount) external virtual onlyOwner {}
}
