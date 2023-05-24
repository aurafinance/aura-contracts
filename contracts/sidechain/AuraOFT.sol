// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { PausableOFT } from "./PausableOFT.sol";
import { CrossChainConfig } from "./CrossChainConfig.sol";
import { CrossChainMessages as CCM } from "./CrossChainMessages.sol";

/**
 * @title   AuraOFT
 * @author  AuraFinance
 * @dev     Sidechain AURA
 */
contract AuraOFT is PausableOFT, CrossChainConfig {
    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */

    /// @dev canonical chain ID
    uint16 public immutable canonicalChainId;

    /* -------------------------------------------------------------------
       Events 
    ------------------------------------------------------------------- */

    /**
     * @dev Emitted when locked cvx on the L1 chain
     * @param caller The msg.sender
     * @param amount The amount of cvx locked.
     */
    event Locked(address indexed caller, uint256 amount);

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */
    /**
     * @dev Constructs the AuraOFT contract.
     * @param _name             The oft token name
     * @param _symbol           The oft token symbol
     * @param _canonicalChainId The canonical chain id
     */
    constructor(
        string memory _name,
        string memory _symbol,
        uint16 _canonicalChainId
    ) PausableOFT(_name, _symbol) {
        canonicalChainId = _canonicalChainId;
    }

    /**
     * Initialize the contract.
     * @param _lzEndpoint LayerZero endpoint contract
     * @param _guardian   The pause guardian
     */
    function initialize(address _lzEndpoint, address _guardian) external onlyOwner {
        _initializeLzApp(_lzEndpoint);
        _initializePauseGuardian(_guardian);
    }

    /* -------------------------------------------------------------------
       Setter Functions
    ------------------------------------------------------------------- */

    /**
     * @dev Sets the configuration for a given source chain ID and selector.
     * @param _srcChainId The source chain ID.
     * @param _selector The selector.
     * @param _config The configuration.
     */
    function setConfig(
        uint16 _srcChainId,
        bytes32 _selector,
        Config memory _config
    ) external override onlyOwner {
        _setConfig(_srcChainId, _selector, _config);
    }

    /* -------------------------------------------------------------------
       Core Functions
    ------------------------------------------------------------------- */

    /**
     * @dev Lock CVX on the L1 chain
     * @param _cvxAmount Amount of CVX to lock for vlCVX on L1
     */
    function lock(uint256 _cvxAmount) external payable {
        require(_cvxAmount > 0, "!amount");
        _debitFrom(msg.sender, canonicalChainId, bytes(""), _cvxAmount);

        bytes memory payload = CCM.encodeLock(msg.sender, _cvxAmount);

        CrossChainConfig.Config memory config = configs[canonicalChainId][keccak256("lock(uint256)")];

        _lzSend(
            canonicalChainId, ////////// Parent chain ID
            payload, /////////////////// Payload
            payable(msg.sender), /////// Refund address
            config.zroPaymentAddress, // ZRO payment address
            config.adapterParams, ////// Adapter params
            msg.value ////////////////// Native fee
        );

        emit Locked(msg.sender, _cvxAmount);
    }
}
