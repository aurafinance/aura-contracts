// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts-0.8/security/ReentrancyGuard.sol";
import { BridgeDelegateSender } from "./BridgeDelegateSender.sol";

interface IGnosisBridge {
    function transferAndCall(
        address _to,
        uint256 _value,
        bytes memory _data
    ) external;

    event UserRequestForSignature(bytes32 indexed messageId, bytes encodedData);
}

contract GnosisBridgeSender is BridgeDelegateSender {
    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */

    // Todo: Make this a constructor argument
    address constant bridge = 0xf6A78083ca3e2a662D6dd1703c939c8aCE2e268d;

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    constructor(address _crv) {
        crv = _crv;
    }

    /* -------------------------------------------------------------------
       Functions
    ------------------------------------------------------------------- */

    /// _to not in use. Currently forwards to the 'l1Delegate'
    function send(address _to, uint256 _amount) external override onlyOwner {
        require(l1Receiver != address(0), "L1ReceiverNotSet");
        bytes memory _data = abi.encodePacked(address(l1Receiver));
        IGnosisBridge(crv).transferAndCall(bridge, _amount, _data);
    }
}
