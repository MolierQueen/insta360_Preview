#import <Foundation/Foundation.h>
#import <CoreImage/CoreImage.h>
#import <ImageIO/ImageIO.h>

static int fail(NSString *message) {
    fprintf(stderr, "%s\n", message.UTF8String);
    return 1;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 7) {
            fprintf(stderr, "usage: %s sdr.jpg hdr-rgbah.raw width height headroom output.heic\n", argv[0]);
            return 2;
        }
        NSURL *sdrURL = [NSURL fileURLWithPath:@(argv[1])];
        NSData *raw = [NSData dataWithContentsOfFile:@(argv[2]) options:NSDataReadingMappedIfSafe error:nil];
        size_t width = strtoull(argv[3], NULL, 10);
        size_t height = strtoull(argv[4], NULL, 10);
        float headroom = strtof(argv[5], NULL);
        if (!raw || raw.length != width * height * 8) return fail(@"invalid HDR half-float input");

        CIImage *sdr = [CIImage imageWithContentsOfURL:sdrURL options:@{kCIImageApplyOrientationProperty: @YES}];
        if (!sdr) return fail(@"cannot decode SDR image");
        CGColorSpaceRef linear = CGColorSpaceCreateWithName(kCGColorSpaceExtendedLinearSRGB);
        CIImage *hdr = [CIImage imageWithBitmapData:raw bytesPerRow:width * 8
                                              size:CGSizeMake(width, height)
                                            format:kCIFormatRGBAh colorSpace:linear];
        if (!hdr) return fail(@"cannot create HDR image");
        if (@available(macOS 16.0, *)) hdr = [hdr imageBySettingContentHeadroom:headroom];

        CGColorSpaceRef sRGB = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
        CIContext *context = [CIContext contextWithOptions:@{
            kCIContextWorkingColorSpace: (__bridge id)linear,
            kCIContextOutputColorSpace: (__bridge id)sRGB,
        }];
        NSDictionary *options = @{
            (__bridge NSString *)kCGImageDestinationLossyCompressionQuality: @1.0,
            kCIImageRepresentationHDRImage: hdr,
            kCIImageRepresentationHDRGainMapAsRGB: @YES,
        };
        NSData *result = [context HEIFRepresentationOfImage:sdr format:kCIFormatRGBA8
                                                 colorSpace:sRGB options:options];
        if (!result) return fail(@"Core Image failed to encode Adaptive HDR HEIC");
        NSError *error = nil;
        if (![result writeToFile:@(argv[6]) options:NSDataWritingAtomic error:&error]) {
            return fail(error.localizedDescription);
        }
        CGColorSpaceRelease(linear);
        CGColorSpaceRelease(sRGB);
    }
    return 0;
}
