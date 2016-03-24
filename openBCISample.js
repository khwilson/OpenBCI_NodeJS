'use strict';
var gaussian = require('gaussian');
var outliers = require('outliers');
var stats = require('scientific-statistics');

/** Constants for interpreting the EEG data */
// Reference voltage for ADC in ADS1299.
//   Set by its hardware.
const ADS1299_VREF = 4.5;
// Scale factor for aux data
const SCALE_FACTOR_ACCEL = 0.002 / Math.pow(2,4);
// X, Y, Z
const ACCEL_NUMBER_AXIS = 3;
// Default ADS1299 gains array
const CHANNEL_SETTINGS_OBJECT = {gain:24};
const CHANNEL_SETTINGS_ARRAY_DEFAULT =
    [
        CHANNEL_SETTINGS_OBJECT,
        CHANNEL_SETTINGS_OBJECT,
        CHANNEL_SETTINGS_OBJECT,
        CHANNEL_SETTINGS_OBJECT,
        CHANNEL_SETTINGS_OBJECT,
        CHANNEL_SETTINGS_OBJECT,
        CHANNEL_SETTINGS_OBJECT,
        CHANNEL_SETTINGS_OBJECT
    ];

var k = require('./openBCIConstants');

module.exports = {

    parseRawPacket: (dataBuf,packetType,channelSettingsArray) => {
        return new Promise((resolve, reject) => {
            if (dataBuf === undefined || dataBuf === null) reject('Error: [parseRawPacket] dataBuf must be defined.')
            // Packet type optional, defaults to standard
            packetType = packetType || k.OBCIPacketTypeStandard;
            // channelSettingsArray is optional, defaults to CHANNEL_SETTINGS_ARRAY_DEFAULT
            channelSettingsArray = channelSettingsArray || CHANNEL_SETTINGS_ARRAY_DEFAULT;

            switch (packetType) {
                case k.OBCIPacketTypeUserDefined:
                    // Do something with the packet, maybe nothing
                    break;
                case k.OBCIPacketTypeTimeSynced:
                    // Parse the time synced packet
                    break;
                default: //treat as normal packet
                    return this.parsePacketStandard(dataBuf,channelSettingsArray);
            }

        });

        return {
            sampleNumber: dataBuf[1], // byte
            channelData: channelData(),
            auxData: auxData(),
        }
    },
    parsePacketStandard: (dataBuf, channelSettingsArray) => {

    },
    /**
     * @description Takes a buffer filled with 3 16 bit integers from an OpenBCI device and converts based on settings
     *                  of the MPU, values are in ?
     * @param dataBuf - Buffer that is 6 bytes long
     * @returns {Promise} - Fulfilled with Array of floats 3 elements long
     * @author AJ Keller (@pushtheworldllc)
     */
    getAccelDataArray: (dataBuf) => {
        return new Promise(resolve => {
            var accelData = [];
            for (var i = 0; i < ACCEL_NUMBER_AXIS; i++) {
                var index = i * 2;
                accelData.push(self.interpret16bitAsInt32(dataBuf.slice(index, index + 2)) * SCALE_FACTOR_ACCEL);
            }
            resolve(accelData);
        });
    },
    /**
     * @description Takes a buffer filled with 24 bit signed integers from an OpenBCI device with gain settings in
     *                  channelSettingsArray[index].gain and converts based on settings of ADS1299... spits out an
     *                  array of floats in VOLTS
     * @param dataBuf - Buffer with 24 bit signed integers, number of elements is same as channelSettingsArray.length * 3
     * @param channelSettingsArray - The channel settings array, see OpenBCIConstants.channelSettingsArrayInit() for specs
     * @returns {Promise} - Fulfilled with Array filled with floats for each channel's voltage in VOLTS
     * @author AJ Keller (@pushtheworldllc)
     */
    getChannelDataArray: (dataBuf, channelSettingsArray) => {
        return new Promise((resovle, reject) => {
            if (!Array.isArray(channelSettingsArray)) reject('Error [getChannelDataArray]: Channel Settings must be an array!');
            var channelData = [];
            // Iterate through each object in the array
            channelSettingsArray.forEach((channelSettingsObject, index) => {
                if (!channelSettingsObject.hasOwnProperty('gain')) reject('Error [getChannelDataArray]: Invalid channel settings object at index ' + index);
                if (!k.isNumber(channelSettingsObject.gain)) reject('Error [getChannelDataArray]: Property gain of channelSettingsObject not or type Number');
                // Get scale factor
                var scaleFactor = ADS1299_VREF / channelSettingsObject.gain / (Math.pow(2,23) - 1);
                // Each number is 3 bytes, need to traverse index * 3 in the buffer
                index *= 3;
                // Convert the three byte signed integer and convert it
                channelData.push(scaleFactor * this.interpret24bitAsInt32(dataBuf.slice(index, index + 3)));
            });
            resovle(channelData);
        });
    },
    convertSampleToPacket: function(sample) {
        var packetBuffer = new Buffer(k.OBCIPacketSize);
        packetBuffer.fill(0);

        // start byte
        packetBuffer[0] = k.OBCIByteStart;

        // sample number
        packetBuffer[1] = sample.sampleNumber;

        // channel data
        for (var i = 0; i < k.OBCINumberOfChannelsDefault; i++) {
            var threeByteBuffer = this.floatTo3ByteBuffer(sample.channelData[i]);

            threeByteBuffer.copy(packetBuffer, 2 + (i * 3));
        }

        for (var j = 0; j < 3; j++) {
            var twoByteBuffer = this.floatTo2ByteBuffer(sample.auxData[j]);

            twoByteBuffer.copy(packetBuffer, (k.OBCIPacketSize - 1 - 6) + (i * 2));
        }


        // stop byte
        packetBuffer[k.OBCIPacketSize - 1] = k.OBCIByteStop;

        return packetBuffer;
    },

    debugPrettyPrint: function(sample) {
        if(sample === null || sample === undefined) {
            console.log('== Sample is undefined ==');
        } else {
            console.log('-- Sample --');
            console.log('---- Start Byte: ' + sample.startByte);
            console.log('---- Sample Number: ' + sample.sampleNumber);
            for(var i = 0; i < 8; i++) {
                console.log('---- Channel Data ' + (i + 1) + ': ' + sample.channelData[i]);
            }
            for(var j = 0; j < 3; j++) {
                console.log('---- Aux Data ' + j + ': ' + sample.auxData[j]);
            }
            console.log('---- Stop Byte: ' + sample.stopByte);
        }
    },
    samplePrintHeader: function() {
        return (
            'All voltages in Volts!' +
            'sampleNumber, channel1, channel2, channel3, channel4, channel5, channel6, channel7, channel8, aux1, aux2, aux3\n');
    },
    samplePrintLine: function(sample) {
        return new Promise((resolve, reject) => {
            if (sample === null || sample === undefined) reject('undefined sample');

            resolve(
                sample.sampleNumber + ',' +
                sample.channelData[0].toFixed(8) + ',' +
                sample.channelData[1].toFixed(8) + ',' +
                sample.channelData[2].toFixed(8) + ',' +
                sample.channelData[3].toFixed(8) + ',' +
                sample.channelData[4].toFixed(8) + ',' +
                sample.channelData[5].toFixed(8) + ',' +
                sample.channelData[6].toFixed(8) + ',' +
                sample.channelData[7].toFixed(8) + ',' +
                sample.auxData[0].toFixed(8) + ',' +
                sample.auxData[1].toFixed(8) + ',' +
                sample.auxData[2].toFixed(8) + '\n'
            );
        });
    },
    /**
     * @description Convert float number into three byte buffer. This is the opposite of .interpret24bitAsInt32()
     * @param float - The number you want to convert
     * @returns {Buffer} - 3-byte buffer containing the float
     */
    floatTo3ByteBuffer: function(float) {
        var intBuf = new Buffer(3); // 3 bytes for 24 bits
        intBuf.fill(0); // Fill the buffer with 0s

        var temp = float / SCALE_FACTOR_CHANNEL; // Convert to counts

        temp = Math.floor(temp); // Truncate counts number

        // Move into buffer
        intBuf[2] = temp & 255;
        intBuf[1] = (temp & (255 << 8)) >> 8;
        intBuf[0] = (temp & (255 << 16)) >> 16;

        return intBuf;
    },
    /**
     * @description Convert float number into three byte buffer. This is the opposite of .interpret24bitAsInt32()
     * @param float - The number you want to convert
     * @returns {Buffer} - 3-byte buffer containing the float
     */
    floatTo2ByteBuffer: function(float) {
        var intBuf = new Buffer(2); // 2 bytes for 16 bits
        intBuf.fill(0); // Fill the buffer with 0s

        var temp = float / SCALE_FACTOR_ACCEL; // Convert to counts

        temp = Math.floor(temp); // Truncate counts number

        //console.log('Num: ' + temp);

        // Move into buffer
        intBuf[1] = temp & 255;
        intBuf[0] = (temp & (255 << 8)) >> 8;

        return intBuf;
    },
    /**
     * @description Calculate the impedance for one channel only.
     * @param sampleObject - Standard OpenBCI sample object
     * @param channelNumber - Number, the channel you want to calculate impedance for.
     * @returns {Promise} - Fulfilled with impedance value for the specified channel.
     * @author AJ Keller
     */
    impedanceCalculationForChannel: function(sampleObject,channelNumber) {
        const sqrt2 = Math.sqrt(2);
        return new Promise((resolve,reject) => {
            if(sampleObject === undefined || sampleObject === null) reject('Sample Object cannot be null or undefined');
            if(sampleObject.channelData === undefined || sampleObject.channelData === null) reject('Channel cannot be null or undefined');
            if(channelNumber < 1 || channelNumber > k.OBCINumberOfChannelsDefault) reject('Channel number invalid.');

            var index = channelNumber - 1;

            if (sampleObject.channelData[index] < 0) {
                sampleObject.channelData[index] *= -1;
            }
            var impedance = (sqrt2 * sampleObject.channelData[index]) / k.OBCILeadOffDriveInAmps;
            //if (index === 0) console.log("Voltage: " + (sqrt2*sampleObject.channelData[index]) + " leadoff amps: " + k.OBCILeadOffDriveInAmps + " impedance: " + impedance);
            resolve(impedance);
        });
    },
    /**
     * @description Calculate the impedance for all channels.
     * @param sampleObject - Standard OpenBCI sample object
     * @returns {Promise} - Fulfilled with impedances for the sample
     * @author AJ Keller
     */
    impedanceCalculationForAllChannels: function(sampleObject) {
        const sqrt2 = Math.sqrt(2);
        return new Promise((resolve,reject) => {
            if(sampleObject === undefined || sampleObject === null) reject('Sample Object cannot be null or undefined');
            if(sampleObject.channelData === undefined || sampleObject.channelData === null) reject('Channel cannot be null or undefined');

            var sampleImpedances = [];
            var numChannels = sampleObject.channelData.length;
            for (var index = 0;index < numChannels; index++) {
                if (sampleObject.channelData[index] < 0) {
                    sampleObject.channelData[index] *= -1;
                }
                var impedance = (sqrt2 * sampleObject.channelData[index]) / k.OBCILeadOffDriveInAmps;
                sampleImpedances.push(impedance);

                //if (index === 0) console.log("Voltage: " + (sqrt2*sampleObject.channelData[index]) + " leadoff amps: " + k.OBCILeadOffDriveInAmps + " impedance: " + impedance);
            }

            sampleObject.impedances = sampleImpedances;

            resolve(sampleObject);
        });
    },
    interpret16bitAsInt32: function(twoByteBuffer) {
        var prefix = 0;

        if(twoByteBuffer[0] > 127) {
            //console.log('\t\tNegative number');
            prefix = 65535; // 0xFFFF
        }

        return (prefix << 16) | (twoByteBuffer[0] << 8) | twoByteBuffer[1];
    },
    interpret24bitAsInt32: function(threeByteBuffer) {
        var prefix = 0;

        if(threeByteBuffer[0] > 127) {
            //console.log('\t\tNegative number');
            prefix = 255;
        }

        return (prefix << 24 ) | (threeByteBuffer[0] << 16) | (threeByteBuffer[1] << 8) | threeByteBuffer[2];

    },
    impedanceArray: (numberOfChannels) => {
        var impedanceArray = [];
        for (var i = 0; i < numberOfChannels; i++) {
            impedanceArray.push(newImpedanceObject(i+1));
        }
        return impedanceArray;
    },
    impedanceObject: newImpedanceObject,
    impedanceSummarize: (singleInputObject) => {
        var median = stats.median(singleInputObject.data);
        if (median > k.OBCIImpedanceThresholdBadMax) { // The case for no load (super high impedance)
            singleInputObject.average = median;
            singleInputObject.text = k.OBCIImpedanceTextNone;
        } else {
            var cleanedData = singleInputObject.data.filter(outliers()); // Remove outliers
            singleInputObject.average =  stats.mean(cleanedData); // Get average numerical impedance
            singleInputObject.text = k.getTextForRawImpedance(singleInputObject.average); // Get textual impedance
        }
    },
    newSample: function() {
        return {
            startByte: k.OBCIByteStart,
            sampleNumber:0,
            channelData: [],
            auxData: [],
            stopByte: k.OBCIByteStop
        }
    },
    randomSample: function(numberOfChannels,sampleRateHz) {
        var self = this;
        const distribution = gaussian(0,2);
        const sineWaveFreqHz10 = 10;
        const sineWaveFreqHz50 = 50;
        const sineWaveFreqHz60 = 60;
        const pi = Math.PI;
        const sqrt2 = Math.sqrt(2);
        const uVolts = 1000000;

        var sinePhaseRad = new Array(numberOfChannels+1); //prevent index error with '+1'
        sinePhaseRad.fill(0);

        var auxData = [0,0,0];

        return function(previousSampleNumber) {
            var newSample = self.newSample();

            //console.log('New Sample: ' + JSON.stringify(newSample));

            for(var i = 0; i < numberOfChannels; i++) { //channels are 0 indexed
                newSample.channelData[i] = distribution.ppf(Math.random())*Math.sqrt(sampleRateHz/2)/uVolts;

                switch (i) {
                    case 1: // scale first channel higher
                        newSample.channelData[i] *= 10;
                        break;
                    case 2:
                        sinePhaseRad[i] += 2 * pi * sineWaveFreqHz10 / sampleRateHz;
                        if (sinePhaseRad[i] > 2 * pi) {
                            sinePhaseRad[i] -= 2 * pi;
                        }
                        newSample.channelData[i] += (10 * sqrt2 * Math.sin(sinePhaseRad[i]))/uVolts;
                        break;
                    case 3:
                        sinePhaseRad[i] += 2 * pi * sineWaveFreqHz50 / sampleRateHz;
                        if (sinePhaseRad[i] > 2 * pi) {
                            sinePhaseRad[i] -= 2 * pi;
                        }
                        newSample.channelData[i] += (50 * sqrt2 * Math.sin(sinePhaseRad[i]))/uVolts;
                        break;
                    case 4:
                        sinePhaseRad[i] += 2 * pi * sineWaveFreqHz60 / sampleRateHz;
                        if (sinePhaseRad[i] > 2 * pi) {
                            sinePhaseRad[i] -= 2 * pi;
                        }
                        newSample.channelData[i] += (50 * sqrt2 * Math.sin(sinePhaseRad[i]))/uVolts;
                        break;

                }
            }
            if (previousSampleNumber == 255) {
                newSample.sampleNumber = 0;
            } else {
                newSample.sampleNumber = previousSampleNumber + 1;
            }
            newSample.auxData = auxData;

            return newSample;
        };
    },
    scaleFactorAux: SCALE_FACTOR_ACCEL,
    scaleFactorChannel: SCALE_FACTOR_CHANNEL,
    k:k
};

function newImpedanceObject(channelNumber) {
    return {
        channel: channelNumber,
        P: {
            data: [],
            average: -1,
            text: k.OBCIImpedanceTextInit
        },
        N: {
            data: [],
            average: -1,
            text: k.OBCIImpedanceTextInit
        }
    }
}