/*
 *  Copyright (c) 2015 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */

// This code is adapted from https://webrtc.github.io/samples/
// The audio-meter is adapted from https://github.com/cwilso/volume-meter/

"use strict";

let mediaRecorder;
let recordedBlobs;
let mimeType;
let stream;

const recordedVideo = document.querySelector("video#recorded");

const isScreenShareRadio = document.getElementById("screen-share");
const isMicRadio = document.getElementById("mic");

const startButton = document.querySelector("button#start");
const recordButton = document.querySelector("button#record");
recordButton.addEventListener("click", () => {
  if (recordButton.textContent === "Start Recording") {
    startRecording();
  } else {
    stopRecording();
    recordButton.textContent = "Start Recording";
    playButton.disabled = false;
    downloadButton.disabled = false;
  }
});

const playButton = document.querySelector("button#play");
playButton.addEventListener("click", () => {
  const superBuffer = new Blob(recordedBlobs, { type: mimeType });
  recordedVideo.src = null;
  recordedVideo.srcObject = null;
  recordedVideo.src = window.URL.createObjectURL(superBuffer);
  recordedVideo.controls = true;
  recordedVideo.play();
});

const downloadButton = document.querySelector("button#download");
downloadButton.addEventListener("click", () => {
  const blob = new Blob(recordedBlobs, { type: "video/webm" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = "test.webm";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 100);
});

function handleDataAvailable(event) {
  console.log("handleDataAvailable", event);
  if (event.data && event.data.size > 0) {
    recordedBlobs.push(event.data);
  }
}

function getSupportedMimeTypes() {
  const possibleTypes = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=h264,opus",
    "video/mp4;codecs=h264,aac",
  ];
  return possibleTypes.filter((mimeType) => {
    return MediaRecorder.isTypeSupported(mimeType);
  });
}

function startRecording() {
  recordedBlobs = [];
  const options = { mimeType };

  try {
    mediaRecorder = new MediaRecorder(window.stream, options);
  } catch (e) {
    console.error("Exception while creating MediaRecorder:", e);
    reset();
    return;
  }

  console.log("Created MediaRecorder", mediaRecorder, "with options", options);
  recordButton.textContent = "Stop Recording";
  playButton.disabled = true;
  downloadButton.disabled = true;
  mediaRecorder.onstop = (event) => {
    console.log("Recorder stopped: ", event);
    console.log("Recorded Blobs: ", recordedBlobs);
  };
  mediaRecorder.ondataavailable = handleDataAvailable;
  mediaRecorder.start();
  console.log("MediaRecorder started", mediaRecorder);
}

function stopRecording() {
  mediaRecorder.stop();
}

async function init(constraints) {
  try {
    if (isMicRadio.checked) {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } else if (isScreenShareRadio.checked) {
      stream = await navigator.mediaDevices.getDisplayMedia(constraints);
      if (!("CaptureController" in window)) {
        const [videoTrack] = stream.getVideoTracks();
        videoTrack.focus("no-focus-change");
      }
    } else {
      throw new Error("Unsupported input type.");
    }
  } catch (e) {
    console.error("Error:", e);
    reset();
    return;
  }

  recordButton.disabled = false;
  console.log("Stream:", stream);
  window.stream = stream;

  const gumVideo = document.querySelector("video#gum");
  gumVideo.srcObject = stream;

  mimeType = getSupportedMimeTypes()[0]; // Crash and burn if no options, why not...

  startMeter(stream);
}

startButton.addEventListener("click", async () => {
  startButton.disabled = true;

  const hasAutoGainControl = document.querySelector("#autoGainControl").checked;

  let constraints = {
    audio: {
      autoGainControl: hasAutoGainControl,
    },
    video: {
      width: 1280,
      height: 720,
    },
  };

  if (isScreenShareRadio.checked) {
    constraints.video = { ...constraints.video, displaySurface: "browser" };
  }

  if ("CaptureController" in window) {
    const controller = new CaptureController();
    controller.setFocusBehavior("no-focus-change");
    constraints = { ...constraints, controller };
  }

  console.log("Using media constraints:", constraints);
  await init(constraints);
});

function reset() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = undefined;
  }

  document.getElementById('gum').srcObject = undefined;

  startButton.disabled = false;
  playButton.disabled = true;
  recordButton.disabled = true;
  downloadButton.disabled = true;
}

/////////////////

let audioContext = null;
let meter = null;
let rafID = null;
let mediaStreamSource = null;

const canvasContext = document.getElementById("meter").getContext("2d");

function createAudioMeter(audioContext, clipLevel, averaging, clipLag) {
  const processor = audioContext.createScriptProcessor(512);
  processor.onaudioprocess = volumeAudioProcess;
  processor.clipping = false;
  processor.lastClip = 0;
  processor.volume = 0;
  processor.clipLevel = clipLevel || 0.98;
  processor.averaging = averaging || 0.95;
  processor.clipLag = clipLag || 750;

  // this will have no effect, since we don't copy the input to the output,
  // but works around a current Chrome bug.
  processor.connect(audioContext.destination);

  processor.checkClipping = function () {
    if (!this.clipping) return false;
    if (this.lastClip + this.clipLag < window.performance.now()) this.clipping = false;
    return this.clipping;
  };

  processor.shutdown = function () {
    this.disconnect();
    this.onaudioprocess = null;
  };

  return processor;
}

function volumeAudioProcess(event) {
  const buf = event.inputBuffer.getChannelData(0);
  const bufLength = buf.length;
  let sum = 0;
  let x;

  // Do a root-mean-square on the samples: sum up the squares...
  for (let i = 0; i < bufLength; i++) {
    x = buf[i];
    if (Math.abs(x) >= this.clipLevel) {
      this.clipping = true;
      this.lastClip = window.performance.now();
    }
    sum += x * x;
  }

  // ... then take the square root of the sum.
  const rms = Math.sqrt(sum / bufLength);

  // Now smooth this out with the averaging factor applied
  // to the previous sample - take the max here because we
  // want "fast attack, slow release."
  this.volume = Math.max(rms, this.volume * this.averaging);
}

function startMeter(stream) {
  // grab an audio context
  audioContext = new AudioContext();

  // Create an AudioNode from the stream.
  mediaStreamSource = audioContext.createMediaStreamSource(stream);

  // Create a new volume meter and connect it.
  meter = createAudioMeter(audioContext);
  mediaStreamSource.connect(meter);

  // kick off the visual updating
  drawLoop();
}

function drawLoop(time) {
  const WIDTH = 500;
  const HEIGHT = 50;

  // clear the background
  canvasContext.clearRect(0, 0, WIDTH, HEIGHT);

  // check if we're currently clipping
  if (meter.checkClipping()) canvasContext.fillStyle = "red";
  else canvasContext.fillStyle = "green";

  // draw a bar based on the current volume
  canvasContext.fillRect(0, 0, meter.volume * WIDTH * 1.4, HEIGHT);

  // set up the next visual callback
  rafID = window.requestAnimationFrame(drawLoop);
}
