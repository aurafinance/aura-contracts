// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

import { IrCvx } from "../interfaces/IrCvx.sol";
import { OFT } from "./layer-zero/token/oft/OFT.sol";
import { CrossChainMessages } from "./CrossChainMessages.sol";

/**
 * @title L2Coordinator
 * @dev Takes rAURA deposits from rAURA on L1 and distributes them
 *      When rewardClaimed is called on the Booster
 */
contract L2Coordinator is OFT, CrossChainMessages {
    using SafeERC20 for IrCvx;

    /* -------------------------------------------------------------------
      Storage 
    ------------------------------------------------------------------- */

    // Scale multiplier
    uint256 internal constant WAD = 10**18;

    /// @dev Booster contract
    address public booster;

    /// @dev Rate to send CVX on mint
    uint256 public mintRate;

    /// @dev canonical chain ID
    uint16 public canonicalChainId;

    /// @dev CRV Token address
    address public crv;

    /// @dev Contract in charge of bridging crv back to the L1
    address public bridgeDelegate;

    /* -------------------------------------------------------------------
      Events 
    ------------------------------------------------------------------- */

    event UpdateBooster(address sender, address booster);

    event Mint(address sender, address to, uint256 amount);

    event Lock(address from, uint16 dstChainId, uint256 amount);

    event UpdateBridgeDelegate(address bridgeDelegate);

    /* -------------------------------------------------------------------
      Constructor 
    ------------------------------------------------------------------- */

    /**
     * @param _name               Token name
     * @param _symbol             Token symbol
     * @param _lzEndpoint         Layer Zero endpoint address
     * @param _canonicalChainId   The canonical chain ID
     */
    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint,
        uint16 _canonicalChainId,
        address _crv
    ) OFT(_name, _symbol, _lzEndpoint) {
        canonicalChainId = _canonicalChainId;
        crv = _crv;
    }

    /* -------------------------------------------------------------------
      Setter functions 
    ------------------------------------------------------------------- */

    /**
     * @dev Set the Booster address
     * @param _booster Booster address
     */
    function setBooster(address _booster) external onlyOwner {
        booster = _booster;
        emit UpdateBooster(msg.sender, _booster);
    }

    /**
     * @dev Set the bridge delegate
     * @param _bridgeDelegate Bridge delegate address
     */
    function setBridgeDelegate(address _bridgeDelegate) external onlyOwner {
        bridgeDelegate = _bridgeDelegate;
        emit UpdateBridgeDelegate(_bridgeDelegate);
    }

    /* -------------------------------------------------------------------
      Core functions 
    ------------------------------------------------------------------- */

    /**
     * @dev Mint function called by Booster.rewardClaimed. rCVX tokens are
     *      minted on the L1 chain and sent to this contract on the L2 chain
     *      when rewardClaimed is called on the booster rCVX tokens are sent
     *      to the sender.
     * @param _to     Address to send rCvx to
     * @param _amount Amount of CRV rewardClaimed was called with
     */
    function mint(address _to, uint256 _amount) external {
        require(msg.sender == booster, "!booster");
        uint256 amount = (_amount * mintRate) / WAD;
        _transfer(address(this), _to, amount);
        emit Mint(msg.sender, _to, amount);
    }

    /* -------------------------------------------------------------------
      Layer Zero functions L2 -> L1
    ------------------------------------------------------------------- */

    /**
     * @dev Send BAL rewards tokens from L2 to L1
     */
    function flush() external onlyOwner {
        uint256 bal = IERC20(crv).balanceOf(address(this));
        IERC20(crv).transfer(bridgeDelegate, bal);
    }

    /**
     * @dev Called by the booster.earmarkRewards to siphon rewards from L1
     * @param _crvAmount Amount of CRV that was received as rewards
     */
    function queueNewRewards(uint256 _crvAmount) external {
        require(msg.sender == booster, "!booster");

        bytes memory _payload = _encode(address(0), 0, _crvAmount, MessageType.SIPHON);

        _lzSend(
            // destination chain
            canonicalChainId,
            // to address packed with crvAmount
            _payload,
            // refund address
            payable(msg.sender),
            // ZRO payment address
            address(0),
            // adapter params
            bytes("")
        );
    }

    /**
     * @dev Lock AURA on the L1 chain
     * @param _cvxAmount Amount of AURA to lock for vlAURA on L1
     */
    function lock(uint256 _cvxAmount) external {
        _debitFrom(msg.sender, canonicalChainId, bytes(""), _cvxAmount);

        bytes memory payload = _encode(msg.sender, address(0), _cvxAmount, MessageType.LOCK);

        _lzSend(
            // destination chain
            canonicalChainId,
            // to address packed with crvAmount
            payload,
            // refund address
            payable(msg.sender),
            // ZRO payment address
            address(0),
            // adapter params
            bytes("")
        );

        emit Lock(msg.sender, canonicalChainId, _cvxAmount);
    }

    /* -------------------------------------------------------------------
      Layer Zero functions L1 -> L2
    ------------------------------------------------------------------- */

    /**
     * @dev Overrite the default OFT lzReceive function logic to
     *      Support siphoning
     */
    function _nonblockingLzReceive(
        uint16 _srcChainId,
        bytes memory _srcAddress,
        uint64 _nonce,
        bytes memory _payload
    ) internal virtual override {
        if (_isCustomMessage(_payload)) {
            MessageType messageType = _getMessageType(_payload);

            if (messageType == MessageType.SIPHON) {
                // The message type is SIPHON which means the message was sent by
                // SiphonDepositor.siphon.
                (address toAddress, uint256 cvxAmount, uint256 crvAmount, ) = _decodeSiphon(_payload);

                // The mint rate is the amount of CVX we mint for 1 CRV received
                // It is sent over each time siphon is called on the L1 to try and keep
                // the L2 rate as close as possible to the L1 rate
                mintRate = (cvxAmount * WAD) / crvAmount;

                // Continue with LZ flow with crvAmount removed from payload
                _payload = abi.encode(abi.encodePacked(toAddress), cvxAmount);
                super._nonblockingLzReceive(_srcChainId, _srcAddress, _nonce, _payload);
            }
        } else {
            // Continue with the normal flow for an OFT transfer
            super._nonblockingLzReceive(_srcChainId, _srcAddress, _nonce, _payload);
        }
    }
}
