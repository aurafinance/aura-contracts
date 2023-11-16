// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { BridgeDelegateSender } from "./BridgeDelegateSender.sol";

interface IZkevmBridge {
    function bridgeAsset(
        uint32 destinationNetwork,
        address destinationAddress,
        uint256 amount,
        address token,
        bool forceUpdateGlobalExitRoot,
        bytes calldata permitData
    ) external payable;
}

contract ZkevmBridgeSender is BridgeDelegateSender {
    using SafeERC20 for IERC20;

    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */

    /// @dev Destination chain label
    uint32 public constant dstChainLabel = 0;

    /// @dev The zkevm bridge address
    address public immutable bridge;

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    /**
     * @dev Constructs the ZkevmBridgeSender contract.
     * @param _bridge The zkevm bridge address.
     * @param _crv The L2 token address.
     */
    constructor(address _bridge, address _crv) {
        bridge = _bridge;
        crv = _crv;
    }

    /* -------------------------------------------------------------------
       Functions
    ------------------------------------------------------------------- */

    /**
     * @dev Function to send a specified amount of tokens.
     * Requirements:
     * - The caller must be the owner of the contract.
     * @param _amount The amount of CRV tokens to be sent
     */
    function send(uint256 _amount) external override onlyKeeper {
        require(l1Receiver != address(0), "L1ReceiverNotSet");
        IERC20(crv).safeApprove(bridge, 0);
        IERC20(crv).safeApprove(bridge, _amount);
        IZkevmBridge(bridge).bridgeAsset(dstChainLabel, l1Receiver, _amount, crv, true, "");
        emit Send(l1Receiver, _amount);
    }
}
