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

## Object properties and interpolation

The most basic thing we want to animate is the object positions.
The position between frames is interpolated. For now we use a linear interpolation, we will soon proving easing options.
Polyline interpolation happens point by point.
We also want interpolate the following properties:
- colors
- opacity
- 3D arrow properties (length, tip size, etc...)
- font size
- lines offset (for line with style double line)
- frequency and amplitude for zig-zag lines


## Onion view and movements path

On N+1 frame we show with opacity 10% the previous object position (if still in the scene), with a special element that shows the movement path. The path should be modifyable as a polyline, so that we can define the exact movement, which may not be lineas, instead the movement between two frames may happen along a spline based path. Like for polyline, we should be able to add points and move the anchors. In order to make it clear we are operating on a movement path rather than a polyline, we want to use a thick semitransparent purple line.


## Phase 2:

Implement properties interpolation, onion view and movement paths.


## Special effects

We want to add a new button in object properties to pick an animation to be used when the element enter/exit the stage.

Effects are available by clicking the a new Effects button in the element properties panel, which opens a panel similar to the one we you in youcoach video analysis.
The icons for each effect are available here: @/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachvideo/client/src/assets/icons/


Enter animations available for all the objects:
- None
- Fade in
- Zoom
- Drop
- Float Up
- Float Down
- Float Left
- Float Right
- Slide Up
- Slide Down
- Slide Left
- Slide Right

Exit animations available for all the objects:
- None
- Fade out
- Zoom
- Lift
- Float Down
- Float Up
- Float Right
- Float Left
- Slide Down
- Slide Up
- Slide Right
- Slide Left


The user should be able to enable/disable effects/canned animations for each element.
All animations are on by default.



### Lines

In excess to the animations above, line also have the path option, which means the line form itself following the its path. Note that if the line ends with an arrow tip, the tip should travel along the line forming.

### Closed paths

Closed paths divide the effects in effect applied to the border and the effect applied to the fill.
For the fill, standard effects apply. For the border, the lines effect apply (which is formation of the path + all the standard effects)



## Phase 3: effects

Implement the standard effects and the effects panel for in/out animations.


## Text Effects

- All the standard one
- Add a text specific category to the effects with:
 - None
 - Typewriter



Implement standard effects to the rest of the elements:
- arrow 3D
- tokens
- figures
- objects 3D (players and materials)

## Arrow 3D

Assume
- arrow completeness
- thickness
- stick width
- tip width
- tip length
as object properties.
Add the standard effects, plus the category Arrow Length which should have an effect like the path for lines, but separated, so we can decide to add or not opacity effect as base effect.
The path effect on arrow 3D simply animate the completeness property from 0 to the value set by the user.

