// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { IBridgeDelegate } from "../../interfaces/IBridgeDelegate.sol";

interface ISiphonDepositor {
    function repayDebt(uint16, uint256) external;
}

contract DummyBridge is IBridgeDelegate {
    address public siphonDepositor;

    address public crv;

    uint16 public srcChainId;

    constructor(
        address _siphonDepositor,
        address _crv,
        uint16 _srcChainId
    ) {
        siphonDepositor = _siphonDepositor;
        crv = _crv;
        srcChainId = _srcChainId;
    }

    function bridge(uint256 amount) external {
        // This is just a dummy bridge running on the same chain as the L1 it is
        // sending CRV to but in reality this will need to call whatever bridging
        // function would send the CRV to L1. ie If it's LZ calling the OFT sendTo
        // function
        IERC20(crv).transfer(siphonDepositor, amount);
    }
}
