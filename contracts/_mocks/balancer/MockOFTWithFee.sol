// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { OFT } from "contracts/layerzero/token/oft/OFT.sol";
import { IOFTWithFee } from "contracts/layerzero/token/oft/extension/IOFTWithFee.sol";
import { LzLib } from "contracts/layerzero/libraries/LzLib.sol";

contract MockOFTWithFee is OFT, IOFTWithFee {
    /**
     * @dev Constructs the MockOFTWithFee contract
     * @param _name       The oft token name
     * @param _symbol     The oft token symbol
     */
    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint
    ) OFT(_name, _symbol) {
        _initializeLzApp(_lzEndpoint);
    }

    function estimateSendAndCallFee(
        uint16 _dstChainId,
        bytes32 _toAddress,
        uint256 _amount,
        bytes calldata _payload,
        uint64 _dstGasForCall,
        bool _useZro,
        bytes calldata _adapterParams
    ) public view virtual override returns (uint256 nativeFee, uint256 zroFee) {
        // silence is golden
    }

    function sendFrom(
        address _from,
        uint16 _dstChainId,
        bytes32 _toAddress,
        uint256 _amount,
        uint256,
        LzCallParams calldata _callParams
    ) external payable override {
        _send(
            _from,
            _dstChainId,
            abi.encodePacked(LzLib.bytes32ToAddress(_toAddress)),
            _amount,
            _callParams.refundAddress,
            _callParams.zroPaymentAddress,
            _callParams.adapterParams
        );
    }

    function sendAndCall(
        address _from,
        uint16 _dstChainId,
        bytes32 _toAddress,
        uint256 _amount,
        uint256,
        bytes calldata,
        uint64,
        LzCallParams calldata _callParams
    ) external payable override {
        _send(
            _from,
            _dstChainId,
            abi.encodePacked(LzLib.bytes32ToAddress(_toAddress)),
            _amount,
            _callParams.refundAddress,
            _callParams.zroPaymentAddress,
            _callParams.adapterParams
        );
    }

    function quoteOFTFee(uint16, uint256) public view virtual returns (uint256 fee) {
        fee = 0;
    }

    function estimateSendFee(
        uint16 _dstChainId,
        bytes32 _toAddress,
        uint256 _amount,
        bool _useZro,
        bytes calldata _adapterParams
    ) external view override returns (uint256 nativeFee, uint256 zroFee) {
        // silence is golden
    }

    function debitFrom(
        address _from,
        uint16,
        bytes memory,
        uint256 _amount
    ) public virtual returns (uint256) {
        address spender = _msgSender();
        if (_from != spender) _spendAllowance(_from, spender, _amount);
        _burn(_from, _amount);
        return _amount;
    }

    function creditTo(
        uint16,
        address _toAddress,
        uint256 _amount
    ) public virtual returns (uint256) {
        _mint(_toAddress, _amount);
        return _amount;
    }
}
