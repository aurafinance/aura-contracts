// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IAuraBalProxyOFT {
    function harvest(uint256[] calldata _totalUnderlying, uint256 _totalUnderlyingSum) external;

    function processClaimable(
        address _token,
        uint16 _srcChainId,
        address _zroPaymentAddress
    ) external payable;
}

/**
 * @title   AuraBalProxyOFTHelper
 * @author  AuraFinance
 * @notice  Allows to invoke harvest and process claimable for all supported chains.
 */

contract AuraBalProxyOFTHelper {
    IAuraBalProxyOFT public immutable auraBalProxy;

    /**
     * @param _auraBalProxy     AuraBalProxy.sol
     */
    constructor(address _auraBalProxy) {
        auraBalProxy = IAuraBalProxyOFT(_auraBalProxy);
    }

    /**
     * @dev Multicall, first harvest the auraBalProxyOFT then it process claimable rewards.
     *  -- harvest --
     * @param _totalUnderlying Array of totalUnderlying auraBAL staked on the source chain
     * @param _totalUnderlyingSum Sum of values in _totalUnderlying array
     *  -- processClaimable --
     * @param _tokens The tokens to process
     * @param _srcChainIds The source chain IDs
     * @param _zroPaymentAddresses The LayerZero ZRO payment addresses
     */
    function callHarvestAndProcessClaimable(
        // harvest args
        uint256[] memory _totalUnderlying,
        uint256 _totalUnderlyingSum,
        // processClaimable args
        address[] memory _tokens,
        uint16[] memory _srcChainIds,
        address[] memory _zroPaymentAddresses
    ) external {
        auraBalProxy.harvest(_totalUnderlying, _totalUnderlyingSum);
        _processClaimable(_tokens, _srcChainIds, _zroPaymentAddresses);
    }

    function _processClaimable(
        address[] memory _tokens,
        uint16[] memory _srcChainIds,
        address[] memory _zroPaymentAddresses
    ) internal {
        uint256 tokensLen = _tokens.length;
        require(tokensLen == _srcChainIds.length && tokensLen == _zroPaymentAddresses.length, "!parity");
        uint256 nativeFee = msg.value / tokensLen;
        for (uint256 i = 0; i < tokensLen; i++) {
            auraBalProxy.processClaimable{ value: nativeFee }(_tokens[i], _srcChainIds[i], _zroPaymentAddresses[i]);
        }
    }

    /**
     * @dev Multicall for process claimable rewards
     * @param _tokens The tokens to process
     * @param _srcChainIds The source chain IDs
     * @param _zroPaymentAddresses The LayerZero ZRO payment addresses
     */
    function processClaimable(
        address[] memory _tokens,
        uint16[] memory _srcChainIds,
        address[] memory _zroPaymentAddresses
    ) external payable {
        _processClaimable(_tokens, _srcChainIds, _zroPaymentAddresses);
    }
}
