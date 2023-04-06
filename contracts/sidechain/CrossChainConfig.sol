// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

/**
 * @title Cross Chain Config
 * @dev Setter/Getter logic for cross chain layer zero config
 */
abstract contract CrossChainConfig {
    struct Config {
        bytes adapterParams;
        address zroPaymentAddress;
    }

    mapping(uint16 => mapping(bytes4 => Config)) public configs;

    function setConfig(
        uint16 _srcChainId,
        bytes4 _selector,
        Config memory _config
    ) external virtual;

    function _setConfig(
        uint16 _srcChainId,
        bytes4 _selector,
        Config memory _config
    ) internal {
        configs[_srcChainId][_selector] = _config;
    }
}
