/*
 *  Copyright (c) 2015 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */

// This code is adapted from
// https://rawgit.com/Miguelao/demos/master/mediarecorder.html

"use strict";

/* globals MediaRecorder */

let mediaRecorder;
let recordedBlobs;
let mimeType;

const errorMsgElement = document.querySelector("span#errorMsg");
const recordedVideo = document.querySelector("video#recorded");

const isScreenShareRadio = document.getElementById("screen-share");
const isMicRadio = document.getElementById("mic");

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
    errorMsgElement.innerHTML = `Exception while creating MediaRecorder: ${JSON.stringify(e)}`;
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

function handleSuccess(stream) {
  recordButton.disabled = false;
  console.log("Stream:", stream);
  window.stream = stream;

  const gumVideo = document.querySelector("video#gum");
  gumVideo.srcObject = stream;

  mimeType = getSupportedMimeTypes()[0]; // Crash and burn if no options, why not...
}

async function init(constraints) {
  try {
    let stream;
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
    handleSuccess(stream);
  } catch (e) {
    // TODO: Not necessarily gUM.
    console.error("navigator.getUserMedia error:", e);
    errorMsgElement.innerHTML = `navigator.getUserMedia error:${e.toString()}`;
  }
}

document.querySelector("button#start").addEventListener("click", async () => {
  document.querySelector("button#start").disabled = true;

  const hasEchoCancellation = document.querySelector("#echoCancellation").checked;
  const hasAutoGainControl = document.querySelector("#autoGainControl").checked;

  let constraints = {
    audio: {
      echoCancellation: hasEchoCancellation,
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
