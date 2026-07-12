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

## The ball

The 3D ball is somehow a special object because it is used with the 3D players, in which case the global scale is the right choice, but can also be used with tokens on a field where the size of the ball is driven more by its visibility. I propose to allow the ball to scale independently by the players. The idea is to have a switch in the scale options (cube icon): Apply the same scale to all 3D objects (enabled by default) and increase the value of "Big" in the slider to 20x.

The scale options panel for object should be organized as follow:

- A title saying: "3D Objects size (with the scale-3d lucene icon)"
- Global switch with the label "Apply only to this object" (off by default)
- The slider which shows in the icon the boxes lucide icon if the slider is changing the global value, the box lucide icon if the change is only for this object.



Implement the model JSON serializer and loader, so I can save and open projects with the Open and Save to... menu items. The only requirement is to have a "version": "3" property, which will be used to identify youcoach-board fiels saved and stored by our designer.
The next step is to create a special loader/converter for the old version 2 format, we will get to it.


## 3D players

It's now time to give life to our 3D Players. Right now we animate their position and initial pose.
Let's mix their movements with some standard rules related to:
- movement speed (jog, diagonal jog, run)
- movement direction (along the path)
- proximity of the ball (pass=ball going away to another player, kick=ball going away not to another player)
- dribbling (move with the ball close in the movement)

Try to identify rules that can help, and mix animations.

Length of the frame: till now, we always assume a frame length (in terms of time) constant. With animations, the time between two frames could become the longest required to:
- complete the pose animation, use the next animation to reach the correct position.

Prepare a plan, then we can implement it step by step.


## Goalkeeper animations

Let's work on the goalkeeper movements, in particular we are interested in the save.

The type of catch (and the resulting animation) is driven by the pose in the drawing:
- middle
- jumping
- side low
- diving
- middle low
- block

- The ball final position is derived by the catch animation (it may require adatpation of the final x,y,z value of the ball position)

- We need to sync the goalkeeper movement with the ball trajectory and catch time so that the ball properly ends in the goalkeeper's hands

- the animation may displace the goalkeeper final position, so we need the goalkeeper to return to its original position by either using animation 34 (goalkeeper sidestaps) or 28 (jog backward).