# Animation

We want to animate objects on the screen and let the user build an animation.

## Frames

An animation is composed by frames. What we animate is the transition of object properties from a frame to another.

## Transitions

We will define several way object will transition from a frame to another.

## Animation toolbar

This toolbar is where we manage the frames. We present a strip of frames (just the first one of no other frames are available, and an empty frame at the end with a + to add a new frame).
In each frame we should provide a dropdown menu to:
- Removed
- Duplicated (new identical frame placed after the one duplicated)
- Set camera position (it will store the camera position information for the frame, when playing the animation, at this frame the camera fly to this position, in case of the first frame the camera is positioned instantly)
- Reset camera position (it will take the camera position from the previous frame, this is disabled for the first frame)

Each frame represent the new position and properties of each element, and the transition from a frame to another has a fixed time length of 1 second.

A play and stop button should allow to play the animation in a loop. Please note that the user may edit the drawing with any camera position, but the camera position when the animation is played is always set as information in the frame information.

In each frame we can add and remove elements, which will enter of leave the scene.
We also store 

## Phase 1: defining frames.

We should add a toggle button on the main toolbar to show/hide the animation toolbar.

When the animation toolbar is activated, it switches to the first frame. 


