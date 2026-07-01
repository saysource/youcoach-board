# YouCoach Board

YouCoach Board is a graphical application to design drills and tactics, specifically design at this point for soccer, but in the future may be configured for other sports.
It allows the user to place and animate a variety of figures and shapes on an SVG canvas.

YouCoach Board is fully embeddable react based app, able to work as a standalone tool and as an embeddable tool (like a regular react component), to design drawings.
 
The most important use cases are:
- design drawings inside YouCoach App, a completely separated react application
- inside Youcoach Video Analysis, a completely separated react application
- inside the youcoach website (Drupal) where non-react javascript should able to use it as “viewer/player”
= independent tool hosted on a specific website (i.e. board.youcoach.ai)
- embeddable in an html page to be used as plain viewer for a provided drawing/animation

The drawings are loaded and saved as JSON. An entire chapter of these specs is dedicated to the details of the v1 of the JSON format.

This project is a full rewrite of this jquery based application:
@/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/yceditor

On top of the capabilities offered by the old application, we will introduce new functionalities, such as easing for animations and new types of elements, features that have been implemented at some degree in YouCoach Video Analysis, a different React application which is part of the tools of the YouCoach family: in particular we will borrow the ability to easily create effects (for animating entering and exiting elements) and the element Arrow 3D.
Here are the relevant folders to check about these features:
@/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachvideo/client/src/presentation/canvas/Layer3D.tsx
@/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachvideo/client/src/presentation/figures/effects

A generic javascript API should allow us to load and read the current JSON model.

The rewrite will be fully insipired to the minimalism usability of Excalidraw (https://github.com/excalidraw/excalidraw).

Main features:

- Minimalistic UI, mostly floaring toolbars and a sidenbase visible on demand with libraries of pre-built objects.
- Undo redo stack management
- Multiple selection
- Scale, move, rotate elements
- Keyframe based animation with properties interpolation
- Editable background (selectable background svg image that can be scaled and moved to adjust its position)
- Ability to manage text elements with wrapping box
- Ability to add hand-drawn elements
- Ability to export the entire drill as image
- Ability to export the animation as video mp4
- Ability to load/save in a given JSON format


## Technologies

This project will use:

- React
- Shadcn for UI elements
- Motion for animations
- Zustand for state management
- Tailwind for styling
= Licide icons + custom icons

All these technologies are used already in YouCoach App 2 at @/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachapp2/client from which we should get the tailwind.css customizations for dark and light mode.

## Main UI

The main UI is a container with an always visible floating toolbar.
In the center we will have a canvas.

Other floating buttons will allow to access a main menu for loading/saving JSON files, a mini toolbar to manage zoom, a mini toolbar to manage undo/redo, a button to open a right side drawer with figures library, a button to go full viewport size for when the component is embedded in another app and other pluggable buttons.

### Canvas technology (decided): SVG for editing, canvas for export

The drawable area is a fixed-ratio board (not an infinite whiteboard), with at
most tens of elements on screen — never hundreds. Given that, the interactive
board is **SVG**, not an HTMLCanvas. The reasoning:

- The figures are themselves SVG assets, and field backgrounds need
  user-configurable colors — both are native in SVG (bind `fill` to attributes /
  CSS vars) and awkward on a canvas.
- Selection, multi-select, move/scale/rotate and hit-testing come for free from
  the DOM instead of being reimplemented.
- Animation is declarative through Motion (it animates SVG attributes/transforms
  directly) rather than an imperative rAF loop.
- At our element count, canvas's only real advantage (raw throughput) does not
  apply. Excalidraw uses a canvas because it is a *general, infinite* whiteboard
  optimizing for arbitrary element counts; our problem is different.

The board is a **layer sandwich**:

1. **2D layer — SVG**: background field + figures + path shapes + text. The
   editable core.
2. **3D overlay — WebGL canvas** (three.js): the Arrow 3D element. This is WebGL
   regardless of the 2D choice, so it sits on its own layer.
3. **Export — offscreen canvas**: composites a rasterized snapshot of the SVG
   layer with the WebGL layer's pixels.

Export paths:

- **Image**: serialize the SVG → draw into an offscreen `<canvas>` → `toBlob`.
- **Video (mp4)**: drive the animation deterministically frame-by-frame,
  rasterize each SVG frame to the offscreen canvas, encode via `MediaRecorder`
  (`captureStream`) or `ffmpeg.wasm`.

Two discipline rules keep export reliable (both are easy to break accidentally):

- **No `<foreignObject>` in the rendered/exported tree.** Browsers do not
  reliably rasterize it to canvas. In particular, text wrapping must be laid out
  into `<tspan>` lines via a measure-and-break pass — an HTML overlay may be used
  *only* during active text editing, then committed to tspans.
- **The exported SVG must be self-contained**: inline (not externally
  referenced) figure assets, fonts embedded or pre-measured.

## Look and feel

The app will support light and dark mode. It should be possible to enforce the mode from outside the component when the component is embedded.

## Phase 1:

Create the very initial UI with the main canvas, the main tool bar, the drawer (empty), the main top/left dropdown menu, the zoom bar, the undo/redo bar (all not operational) except for the "resize to fill the viewport icon".


## Phase 2: Minimal designer

In this phase we want to create the initial skeleton of the designer.
The designer will allow to create three types of figures:

- rectangle
- circle/ellipse
- streight line

### Basic features

- Activation of a creation tool (rectangle, circle, line)
- Figure creation: Ability to create a circle/ellispe, a line and a rectangle
- Basic figure selection: be able to select a figure

When the tool is active, the user can click and drag the mouse to draw the rectangle/circle/line by essentially click a point and move to pointer. Once released this will be the bounding box of the new figure. The figure is painted while the pointer drag.
For now just use static properties:
- transparent fill
- stroke 3 px black

Once the figure is created, the selected creation tool automatically deactivates, to activate the selection tool.

In order to select a figure, we need to click on the figure.

A selected figure shows a frame corresponding to its bounding box.

Clicking elsewhere the figure is deselected.

## Undo/Redo stack

We want to draft from the start the undo/redo management. There are many way to manage undo/redo, my suggestion is to implement a stack management similar to the one created for YouCoach Video Analysis which was implemented using redux and thunks, but this is just a detail.

- each operation performed on the model can be undone and redone
- instead of a copy of the model, we store the relevant operation data to be able to undo and redo that operation
- changes are performed only be means of operations that can operate on one or more figures and on one or more attributes, the operation knows how to apply a set of changes
- operations can be grouped to form an atomic operation (useful to define an operation as sequence of multiple other operations)

To have a clear idea of how it is implemented, check:
@/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachvideo/client/src/features/presentation/presentationUndoReduThunks.ts
and relevant files in the same folder.

## Selection figures and handles

Pretty much all the objects use a rectangle which covers the element bounding box, with 4 handles for resize in different directions as selection.
To this rectangle we want to add a 5th handle for rotation, a circle on top. Something cool that excalidraw does is rotating the little square of the for corners of the selection figure to stay always at zero degrees, we may want it too.

An exception is represented by lines (and arrows which are just lines with one or two tips). In that case we want to show only a circular handle at the extremes of the line.

When we will introduce pre-build svg based figure, we will keep the ratio of resized figure, actually scaling it.
The same will be for text.


## Implement resize

All figure showing the 4 handles can be resized. Please note that shapes (rectangle, circe, closed polylines) should not scale when resized, but the points needs to be recalculated.
In case of complex figures (pre-made svg based figures) the element will keep its proportion (but we still don't have this type of figures).
Also implement rotation for figures supporting it (which are all )

## Canvas bounds

elements can be moved and resize freely, but a piece of the figure should always remain inside the canvas, otherwise the user would loose that element, and we want prevent that. Also the elements (maybe not the selection frames) should not overflow the canvas size when drawn. It would probably be good to mark the border of the canvas (ligth 0.4 opacity kind of border, not rounded).

## Polyline

We want to implement a polyline element, which can be either closed or not.
While creating the polyline, the user will click different points on the canvas.
The first and the last points will have a circle. If the user click on one of the two circles (with a bounce animation of the circle on enter with the pointer), the line will end.
If the user press ESC, the line ends open.


# Elements

Elements can be divided in the following main categories:

Figures (like players, materials shapes like ball or cones), and everything that can simply be moved, resized (scaled), rotated 
Path based figures: figures that are defined by a set of points (circle, rectangle, ellipsis, arrows)
3D arrows, managed in an overlay layer with three.js, this very special element type will be implemented based on the same element created for youcoach VA. 


# SVG Figures

SVG figures are figures based on an SVG, which can be added to the drill drawing, the user can proportionally scale, move, rotate that element. The figures a divided in categories and subcategories, defined in YCEditor.prototype.palette_categorie, which is a structure primarily defined for the overall structure of the visual palette, and include categories that are not fixed SVG figures such as the shapes and the fields.

YCEditor.prototype.palette_categorie in @/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/yceditor/js/src/ycdrilleditor.palette.figures.js 

{ label: "Players", 
              options: [
                { name: "players", label: "Players (Male)" },
                { name: "players_female", label: "Players (Female)" },
                { name: "goalkeepers", label: "Goalkeepers (Male)" },
                { name: "goalkeepers_female", label: "Goalkeepers (Female)" },
                { name: "futsal", label: "Futsal" },
                { name: "coaches", label: "Coaches" },
                { name: "referees", label: "Referees" },
                { name: "children", label: "Children" },
                { name: "preparation", label: "Preparation (Male)" },
                { name: "preparation_female", label: "Preparation (Female)" },
                { name: "players_top", label: "Players (from top)" } ]
            },
            { label: "Materials",
              options: [
                { name: "materials", label: "Materials" },
                { name: "discs", label: "Text and Numbers" },
                { name: "shapes", label: "Arrows and Shapes" } ]
            },
            { label: "Fields",
              options: [
                { name: "fields_11", label: "Fields 11" },
                { name: "fields_futsal", label: "Futsal" } ]
            }

## Background and Field SVGs

The canvas background can be configured to use a solid color or a predefined field background image (which resembles simple grass). The background may also overlay to the solid color or the image an SVG that represents a field or part of a field. If the selected SVG for the background does “declare” configurable colors, the user should be able to set these colors. This is the case, for instance, of futsal fields, where the user can set the two colors for the actual floor.
The SVG of the background can be scaled and moved, so the user can use a specific part of the field instead of the whole field represented by the SVG.
Field SVGs are grouped in Field 11 (Soccer field typical for 11vs11) and Futsal fields.


## The OLD model

In this paragraph we will see how the old model (JSON) was organized.
We don't have to stick to this model, definitively it needs to be extended, but it is a good start.

The file @specs/sample_old_json.json contains all the type of object we do support. Figures like the player (images/optimized/players/152.svg) and the ball (images/optimized/materials/15.svg) are imported SVG from a repository that depends by the the tool configuration, in other words these resources are served as statis resources.
Currently all the resources are located in @/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/yceditor/images/optimized/. For each type of figure we have a thumbnail (png) and the actual SVG file.


## Properties panel and responsive design

Let's work on the properties panel, which should show up when an element is selected.
The properties panel allows to set element properties, suche as background color, stroke, stroke width, opacity, etc.

Excalidraw does an incredible job in terms of responsive design, both for what concerns the properties panel and the overall economic of the toobars.

In this task we will create the properties panel. We will just handle the following element properties:

- background color (for closed shapes)
- stroke color
- Stroke width and style
- Opacity

The properties panel should show when an element is selected.

On container >= 1180px, like Excalidraw does, we want to show a full panel.
On container < 1180, the panel becomes a vertical toolbar which group properties in a limited set accessed via a button:
 - background color (for closed shapes)
 - stroke color
 - settings (which opens a full panel with the main settings)
 - other operations usually shown at the bottom of the panel

On container < 768, we enter some sort of mobile mode: the toolbar goes to the bottom with a smaller set of operations and smaller icons,  just on top of this main toolbar, are shown the buttons to access the main properties of the element, instead of using the vertical toolbar, also on the right are shown the undo/redo buttons and the copy and delete icons, useful when no right click or keyboard is available.

Implement this logic, leaving icons for which we still don't have requirements inactive.

We will refine later all the individual properties we want to show in the properties panel and how to group them.


- Add a separator after the Selection tool
- replace the text tool icon with the PlayersIcon available here @/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachapp2/client/src/core/components/season-dashboard/icons.tsx
- replace the image icon with the TrainingIcon available here @/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachapp2/client/src/core/components/season-dashboard/icons.tsx
- Add a separator before the erase icon

- The more tools icon should show a dropdown menu with the following items

- Players (with the PlayersIcon)
- Materials (with the TrainingIcon)
- Shapes (with the icon defined here @assets/shapes.svg , which must be trasfromed in a Lucide kind of icon)
- Arrows (Lucide move-right icon)
- Discs (with the icon defined here @assets/disc.svg , which must be trasfromed in a Lucide kind of icon)
- a divider
- Background (with the Soccer field icon available here: @/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachapp2/client/src/core/components/icons/SoccerFieldIcon.tsx )


All icons are not operative right now.

## The drawer content

In the drawer, remove the search and add a button which uses as a label the current selected category.
By default, the selected category is "Players (Male)".
When the button is pressed, we show under the button the full list of categories with the macro-category titles:

- Players
  - Players (Male)
  - Players (Female)
  - Goalkeepers (Male)
  - Goalkeepers (Female)
  - Futsal
  - Coaches
  - Referees
  - Children
  - Preparation (Male)
  - Preparation (Female)
  - Players (from top)
- Materials
  - Materials
  - Text and Numbers
  - Arrows and Shapes
- Fields and Background
  - Fields 11
  - Futsal

By clicking on a category, we show all the available element for that category.
We still need to define what to show in each category, for now use an empty div.



## TODO
- eraser tool
- copy and paste
- JSON export/import
- background SVG adjust
- canvas zoom
- laser pointer
- presentation mode
- Skin Editor
- Kit Editor
- Import image (where to save it?)
- Text support with frame
- export image
- animation mode
- snap to geometry
- mini-tool help
- keyboard shortcuts
- create formation
- i18n
- favorites figures
- multiline point dragging align with other points.


## Properties element by element

- Rectangle and ellipse
  - fill color
  - stroke color (with opacity)
  - stroke style (thin / medium / think)
  - opacity (overall opacity)
  - Special actions: Lock proportions

- Line 
  - fill color (if closed)
  - stroke color (with opacity)
  - stroke style (thin / medium / think)
  - opacity (overall opacity)
  - start tip (none / arrow / circle)
  - end tip (none / arrow / circle)
  - style (solid / dashed / dotted)
  - type (streight / quadratic bezier / cubic bezier)
  - Special actions: open / close, if the line has more than 3 points

- Player
  - kit config
  - skin config
  - opacity
  - scale (the default value of the scale may be tied to the type of field we are working with)
  - Special actions: flip horizontally, copy style (for kit and skin)

- Material
  - color (apply only to selected materials)
  - scale (the default value of the scale may be tied to the type of field we are working with)
  - Special actions: flip horizontally
  
- Text
  - text color (with opacity)
  - fill color (with opacity)
  - text padding
  - opacity (overall opacity)
  - text (it must support multiline text)

- Disc
  - color1 (with opacity), by default used for the center of the disc
  - color2 (with opacity), by default the ring color
  - disc style (disc / tshirt)
  - opacity (overall opacity)
  - text (single line)

## Color picker

Avoid using the browser default color picker, instead use the react-colorful and includes opacity information in stroke and fill colors.
We also want to provide the ability for the user to use the color picker tool.
The proposed 5 colors shown when editing the fill color should remember the last selection, with a FIFO strategy.
The same for stroke and text colors.

## Remembering color and styles

Once an element is selected, we keep its attributes as default values for the next creatio of element of the same category (fill, stroke, kit, skin, opacity, styles).


## Copy and paste

Implement copy and paste, when one or more elements are selected.

## Background editing mode

If the user select a Field from the palette either by dragging or clicking, we show as background SVG the selected SVG.
The very bottom of the background is our default field0 image. The user can modify the background SVG by enable "Edit background" which will show a 


## SVG player and figures

All the SVG are made of paths, some of which are clearly marked with a special class name to be dinamycally coloured.
The classes are:

- yc-hair
- yc-skin
- base_tshirt
- shorts
- socks
- v_stripe
- h_stripe

For materials:

- yc-color-1
- yc-color-2



Kicking
Running
Standing
Throw In
Special
Dribbling
Pass




Now that the drawer is ready, enable the items in the More Tools dropdown in the main toolbar.
In that menu we show as first items all the main categories.

When the user clicks on the category we open the drawer (if closed or not pinned) and move to the selected category.

The Background menu point to the Fields category: we want to call it background because we will activate a special "mode" to show in the properties the background settings/properties when the fields category is activated.


Under the list of categories, after a separator, we want to also the following actions/shortcuts:
- Add Ball (with the MatchIcon from @/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachapp2/client/src/core/components/season-dashboard/icons.tsx )
- Add Text

The shortcuts will add a ball (the first item of the materials with action "material.balls").
Since the ball will have a special treatment when we will work on animantions, we want to flag the fact that a figure element is a ball in our model.


## Background Settings

While Field 11 and Futsal are actually two distinct categories, we may want to show them as both independent categories we may consider to add a virtual category All Fields, which will treat Field 11 and Futsal as subcategories/actions. This is to simplify the next step in which, we want to choose a background quickly by showing the drawer, without having the user to guess that for futsal it needs to change category.

Change the More tools menu item "Background" in "Edit Background" and move it as last option in the current menu, with a separator.
When the user clicks on Edit background we will show the All fields category

When one of the categories of the fields macro-category is selected (which is all categories of kind "field"), 

When a field category is selected, in the properties panel we show:

- the ability to select a solid background and its color
- the ability to scale the SVG representing the field
- the ability to pan the SVG by showing the svg @assets/move_background.svg on top of the canvas
- select a logo position

The logo position refer to the position of the youcoach logo @/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachapp2/client/src/core/assets/youcoachapp_logo_dark.svg shown on top of the background image with 0.2 opacity.
The positions are: center / top-left / top-right / bottom-left / bottom-right

------------

## Shapes menu

The Rectangle tool menu item in the main toolbar should become a more generic Shapes menu.
The default icon should be @assets/shapes.svg, which is what is used when no previous shape tool was selected.
The icon opens a drop down with the following shapes:
- Rectangle
- Ellipse
- Diamond
- Penthagon
- Triangle
- Trapezoid

As the user select a shape type, this becomes the selected tool, and in the main toolbar we replace the generic Shapes icon with the one of the selected tool.
If the user, upon opening the dropdown, does not make any choice, we activate automatically the last shape tool used, and the menu closes automatically by clicking outside it.
I provided the icon for @assets/shapes.svg, the only one missing.


## Arrows menu

The Arrow tool menu item in the main toolbar should become a more generic Lines menu.
The default icon should be @assets/lines.svg, which is what is used when no previous line/arrow tool was selected.
The icon opens a drop down with the following shapes:

- Arrow
- Line
- Elbow arrow (really a cubic bezier)
- Elbow line

As the user select a line/arrow type, this becomes the selected tool, and in the main toolbar we replace the generic Lines icon with the one of the selected tool.
If the user, upon opening the dropdown, does not make any choice, we activate automatically the last line tool used, and the menu closes automatically by clicking outside it.

### More about lines and arrow

Line/Arrow style can be of 2 types: streight or curved.
The tool Miro does a great job in siplyfing how the user can adjust the curve and adding/removing points to a ployline.
It shows between points special mid-points (let's call them anchors).
If the line is "streight", dragging an anchor will actually split the segment in two sub-segments.
If the line is "curved", bezier is automatically calculated between points, and dragging an anchor will add new curve point.
Double clicking a point (except for last and first) will remove that pont/joint.


The options for the line style are actually 3: simple, quadratic bezier and cubic bezier, but simple simply means that we use a quadratic with no curve.

If a line/arrow is composed of multiple segments, the bezier handles 


## Properties panel / properties bar

We want to drop the full panel view for the properties and stick with the minimal properties toolbar.
The properties toolbar will contain a set of icons/buttons.
By clicking the button, we will open a dropdown panel/widget with which settings can be easily modified.

The main widgets:
- background (applies to rectangle, ellipse, closed polylines and text pillow), it is represented in the toolbar by a circle coloured with the selected color, checkerboard background for opacity clarity and filled with the selected fill style; the opened widget shows:
  - fill style: solid / diagonal rows
  - color picker (more about the color picker later)
- border color show simply the color picker
- other props (settings icon): show properties specific to each element type:
  - stroke thick
  - stroke style
  - line style: streight or curved (icons strip to change the value)
  - arrow heades: two dropdowns, one for end, one for start, showing the options none, circe, arrow tip
  - close path: single toggle button ( @assets/close_path.svg)
  - font size (text elements)
  - padding (text elements)
  - opacity (global figure opacity)

- Kit and skin options (for later)
  - kit config
  - skin config
- Actions: a three dots icon to open a dropdown menu with several options:
  - Copy
  - Duplicate
  - Flip (only for SVG figures)
  - Arrange
    - Bring forward
    - Bring to Front
    - Send backword
    - Send to back
  - Copy style (included kit and skin config in case of players)
  - Paste style


### Properties element by element

- Rectangle and ellipse
  - fill color
  - stroke color (with opacity)
  - stroke thickness (thin / medium / think)
  - stroke style (thin / medium / think)
  - opacity (global figure opacity)

- Line 
  - fill color (if closed)
  - stroke color (with opacity)
  - stroke style (thin / medium / think)
  - opacity (overall opacity)
  - start tip (none / arrow / circle)
  - end tip (none / arrow / circle)
  - style (solid / dashed / dotted)
  - type (streight / quadratic bezier / cubic bezier)

- Player
  - kit config
  - skin config
  - opacity

- Material
  - color (apply only to selected materials)
  - scale (the default value of the scale may be tied to the type of field we are working with)
  
- Text
  - text color (with opacity)
  - fill color (with opacity)
  - text padding
  - opacity (overall opacity)

- Disc
  - color1 (with opacity), uses the border color type of button/widget
  - color2 (with opacity), uses the border color type of button/widget
  - disc style (disc / tshirt)
  - opacity (overall opacity)

- Materials
  - color1 (with opacity)
  - color2 (with opacity)
  - disc style (disc / tshirt)
  - opacity (overall opacity)


### Color picker widget

The color picker widget is composed by two parts:
a set of 5 colors the user can choose from, shown as rounded rectangles.
The first color should be always the fully transparent one, and then a list of preset colors, which are replaced with the last selected colors based on the property being edited (border/text, color 1 and 2, background), with a FIFO strategy.
A color picker widget which allows to specify a color in format of hex code, and the picker pen, as implemented here: @/Users/gtoffoli/Saysource/progetti/Youcoach/GIT/youcoachapp2/client/src/core/components/ui/color-picker.tsx
This color picker uses a drowpdown react-colorful dropdown, in our case the dropdown will show just the simple react-colorful colorpicker component, included opacity slider.

### More about Disc and disc style

For now we have a single type of disc, which is driven by the catalog. We will add other disc styles and maybe create an ad hoc editor for it like we will do for the player kit and skin/hairs.
Ignore it for now by providing a single option.


## Zigzag lines

Implement the line syile "Zigzag". The line will work like a curved line (bezier), but the actual line is rendered as zigzag curve along the main path based on two parameters:
- frequency
- amplitude

The editig should be similar to a regular curved line, with the same logic for the anchor points.

Zigzag will be a third line style, with icon @assets/line_style_zigzag.zvg

## Double lines

A double line is our forth type of line style. Like the zigzag, it is based on a curved line (bezier) and it renders two parallel lines equally distant from the reference path.
The distance between the two lines will be governed by the property lines offset (from 10 to 100).


- Add an action to the context menu to transform a rectangle to a polyline.

## Text elements

Text elements show a text on the canvas. The text should support multiline.
The text is wrapped by a rounded rectangle, which can eventually be transparent, having 5px pad.
In the properties panel we present:
- Text Color (similar to stroke color widget) default should be black-
- Background Color (we can use the background widget), without the background style, just the color and opacity
- Text Setting
- Font size (slider from 2 to 200)
- text alignment (default center, useful only where there are multiple lines)

On double click on the element, the user should be able to edit the text. Enter should be accepted as characted. The start of the text editing starts and undo transaction, which is closed on blur of the inline fully transparent textarea used for the editing of the text.
When editing, we we want to have the feeling of editing the SVG. The inline editing 

The background rounded rectangle should be calculated accordingli to the text bbox with a min width and height to fit the M character.
 



## Background Editig

So far we show the handle to move the background and the background properties panel when the we show the fields category in the drawer.
Centering (or moving) the background should be a clear state of the editor that disable all the other actions and shold be committed somehow.
Here is the idea

The background toolbar should be shown upon clicking edit background and we enter the edit background mode, showing the arrows indicating the possibility to move the background.

In the toolbar we show
- background color icon, which would open a color picker with the default colors we provide for the background
- the settings icon to edit scale and logo position
- a reset background icon

- In background edit mode, the drawer only show fields categories
- The main toolbar will show just a button "Finish editing background" (or something similar) which will allow to exit the background mode.

At any time, by pressing, ESC we will exit the background editing mode.

The arrows icon shown in the canvas to move the background should be bigger.


- When we create a new token, if a token is present on the board, we want to use the same size, if not present, we want to honour the selected backgorund scale.

