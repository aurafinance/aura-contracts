// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";

// TODO  - MOVE TO layer-zero own path
interface ISiphonDepositor {
    function repayDebt(uint16, uint256) external;
}

contract DummyBridge {
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

    function repayDebt() external {
        uint256 bal = IERC20(crv).balanceOf(address(this));
        IERC20(crv).approve(siphonDepositor, bal);
        ISiphonDepositor(siphonDepositor).repayDebt(srcChainId, bal);
    }
}
