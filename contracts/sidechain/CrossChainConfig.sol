// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

/**
 * @title   Cross Chain Config
 * @author  AuraFinance
 * @dev     Setter/Getter logic for cross chain layer zero config
 */
abstract contract CrossChainConfig {
    struct Config {
        bytes adapterParams;
        address zroPaymentAddress;
    }

    /// @dev srcChainId mapped to selector and configuration
    mapping(uint16 => mapping(bytes32 => Config)) public configs;
    /* -------------------------------------------------------------------
       Events 
    ------------------------------------------------------------------- */
    /**
     * @dev Emitted a configuration is set for a given source chain id.
     * @param srcChainId    The source chain ID.
     * @param selector      The selector.
     * @param adapterParams The configuration.
     */
    event SetConfig(uint16 indexed srcChainId, bytes32 selector, bytes adapterParams, address zroPaymentAddress);

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
    ) external virtual;

    function _setConfig(
        uint16 _srcChainId,
        bytes32 _selector,
        Config memory _config
    ) internal {
        configs[_srcChainId][_selector] = _config;
        emit SetConfig(_srcChainId, _selector, _config.adapterParams, _config.zroPaymentAddress);
    }
}
