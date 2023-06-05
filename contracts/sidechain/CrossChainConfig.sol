// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

/**
 * @title   Cross Chain Config
 * @author  AuraFinance
 * @dev     Setter/Getter logic for cross chain layer zero config
 */
abstract contract CrossChainConfig {
    /// @dev srcChainId mapped to selector and configuration
    mapping(uint16 => mapping(bytes32 => bytes)) public getAdapterParams;

    /* -------------------------------------------------------------------
       Events 
    ------------------------------------------------------------------- */

    /**
     * @dev Emitted a configuration is set for a given source chain id.
     * @param srcChainId    The source chain ID.
     * @param selector      The selector.
     * @param adapterParams The configuration.
     */
    event SetAdapterParams(uint16 indexed srcChainId, bytes32 selector, bytes adapterParams);

    /**
     * @dev Sets the configuration for a given source chain ID and selector.
     * @param _srcChainId The source chain ID.
     * @param _selector The selector.
     * @param _adapterParams The adapter params.
     */
    function setAdapterParams(
        uint16 _srcChainId,
        bytes32 _selector,
        bytes memory _adapterParams
    ) external virtual;

    function _setAdapterParams(
        uint16 _srcChainId,
        bytes32 _selector,
        bytes memory _adapterParams
    ) internal {
        getAdapterParams[_srcChainId][_selector] = _adapterParams;
        emit SetAdapterParams(_srcChainId, _selector, _adapterParams);
    }
}
