# R8 rules for the release build (minifyEnabled true since 1.6).
#
# Most of the work is done for us: capacitor-android ships consumer rules that
# keep every Plugin subclass and @PluginMethod, and AndroidX/CameraX ship their
# own. What follows is the part R8 cannot infer from this app.

# --- Readable crash reports -------------------------------------------------
# Without these, the mapping file uploaded to Play can rename classes back but
# has no line numbers to map, so a deobfuscated stack trace stops at the method.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# --- Capacitor bridge -------------------------------------------------------
# The bridge reads @CapacitorPlugin, @PermissionCallback and @ActivityCallback
# at runtime to build its plugin registry, so the annotations must survive the
# shrink even though no code references them.
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod

# The bridge instantiates its own internals reflectively (plugin handles, config,
# the JS injector), none of it on a path R8 can trace from the manifest.
-keep class com.getcapacitor.** { *; }
-keep interface com.getcapacitor.** { *; }

# Belt and braces over the consumer rules: any plugin, ours or a dependency's.
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { *; }
-keep public class * extends com.getcapacitor.Plugin { *; }

# The Cordova compatibility shim is loaded by name, not by reference.
-keep class org.apache.cordova.** { *; }

# --- WebView bridge ---------------------------------------------------------
# Anything callable from JavaScript is only ever reached from JavaScript, which
# R8 cannot see.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# --- JNI --------------------------------------------------------------------
# CameraX's native libraries bind to these by name; renaming them breaks the
# link at runtime rather than at build time.
-keepclasseswithmembernames class * {
    native <methods>;
}

# --- Noise ------------------------------------------------------------------
# Build-time-only annotations referenced by libraries but never packaged.
-dontwarn javax.annotation.**
-dontwarn org.codehaus.mojo.animal_sniffer.**
